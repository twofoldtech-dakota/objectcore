// `bun run registry:publish [--dry-run]` — the PUBLISHER side of OIDC publish: the
// HTTP counterpart of `registry:ingest`. Instead of writing the catalog straight into
// the DB (which needs DATABASE_URL), it authenticates with a GitHub Actions OIDC token
// and POSTs each plugin to the live backend's `POST /v1/plugins` route (plan 011) — so
// a publisher needs NO database credential, only `id-token: write`.
//
// Data is reconstructed from the workspace exactly like release:publish (raw manifest +
// relDir + the commit each plugin's RELEASE TAG resolves to (never bare HEAD) + repoUrl +
// an MCP-bundle scan), so the published manifest is the source of truth (not the lossy
// catalog-entry round-trip). The server re-validates via parsePublish and recomputes
// `ref` itself.
//
// Self-gates (green no-op, the registry:ingest posture): skips unless
// OBJECTCORE_REGISTRY_URL is set AND an OIDC token can be obtained. Inert until armed.

import { join } from "node:path";
import { releaseTag, type PublishRequest } from "@objectcore/registry-core";
import { loadWorkspace } from "./_workspace";
import { gitSha, repoUrl, hasMcpConfig, tagSha } from "./_release";

const root = join(import.meta.dir, "..");
const dryRun = process.argv.includes("--dry-run");

const base = (process.env.OBJECTCORE_REGISTRY_URL ?? "").replace(/\/+$/, "");
const audience = process.env.OBJECTCORE_OIDC_AUDIENCE ?? "";
const attested = process.env.OBJECTCORE_ATTESTED === "1" || Boolean(process.env.OBJECTCORE_PROVENANCE_URL);

function skip(reason: string): never {
  console.log(`• registry:publish skipped — ${reason}.`);
  process.exit(0);
}

if (!base) skip("OBJECTCORE_REGISTRY_URL is not set (no registry endpoint configured)");
if (!audience) skip("OBJECTCORE_OIDC_AUDIENCE is not set (cannot mint a scoped OIDC token)");

/** Mint a GitHub Actions OIDC token for `audience`, or use OBJECTCORE_OIDC_TOKEN as an
 *  explicit override (local testing). Returns null when neither is available. */
async function mintOidcToken(aud: string): Promise<string | null> {
  if (process.env.OBJECTCORE_OIDC_TOKEN) return process.env.OBJECTCORE_OIDC_TOKEN;
  const reqUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const reqToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!reqUrl || !reqToken) return null;
  const res = await fetch(`${reqUrl}&audience=${encodeURIComponent(aud)}`, {
    headers: { authorization: `Bearer ${reqToken}` },
  });
  if (!res.ok) throw new Error(`OIDC token request failed: ${res.status}`);
  const body = (await res.json()) as { value?: string };
  if (!body.value) throw new Error("OIDC token response missing 'value'");
  return body.value;
}

const { plugins } = await loadWorkspace(root);
const sha = gitSha(root);
const url = repoUrl(root);
if (!url) skip("no `origin` remote — cannot build git-subdir pin coordinates");

const versioned = plugins.filter((p) => p.manifest.version);
if (!versioned.length) skip("no versioned plugins to publish");

/** Pin sha for a plugin: the commit its release tag resolves to — never bare HEAD,
 *  so re-publishing after unrelated pushes to main cannot drift a version's pin away
 *  from its `{plugin}--v{semver}` ref. Fail closed when the tag is missing. */
function pinSha(name: string, version: string): string {
  const tag = releaseTag(name, version);
  try {
    return tagSha(root, tag);
  } catch {
    console.error(`✗ ${name}@${version}: release tag ${tag} not found — run release:publish (which creates the tags) first`);
    process.exit(1);
  }
}

// A provenance reference attached when the run is attested — satisfies the route's
// provenance gate for MCP-bundling plugins (the server stores the reference; verifying
// the attestation bundle is a follow-up).
const provenance = attested
  ? {
      attested: true,
      sha,
      repo: process.env.GITHUB_REPOSITORY,
      runId: process.env.GITHUB_RUN_ID,
      attestationUrl: process.env.OBJECTCORE_PROVENANCE_URL,
    }
  : undefined;

async function buildRequest(p: (typeof versioned)[number]): Promise<PublishRequest> {
  return {
    manifest: p.manifest,
    relDir: p.relDir,
    version: p.manifest.version as string,
    sha: pinSha(p.manifest.name, p.manifest.version as string),
    repoUrl: url,
    bundlesMcp: await hasMcpConfig(p.dir),
    ...(provenance ? { provenance } : {}),
  };
}

if (dryRun) {
  console.log(`registry:publish (dry run) -> ${base}/v1/plugins [${versioned.length} plugin(s), release commit ${sha.slice(0, 12)}]`);
  for (const p of versioned) {
    const req = await buildRequest(p);
    console.log(`  ${req.manifest.name}@${req.version} @ ${req.sha.slice(0, 12)}${req.bundlesMcp ? " (mcp)" : ""}`);
  }
  console.log("(dry run — no token minted, nothing posted)");
  process.exit(0);
}

const token = await mintOidcToken(audience);
if (!token) skip("no OIDC token available (not in GitHub Actions and OBJECTCORE_OIDC_TOKEN unset)");

let ok = 0;
let skipped = 0;
let failed = 0;
for (const p of versioned) {
  const req = await buildRequest(p);
  const res = await fetch(`${base}/v1/plugins`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(req),
  });
  if (res.ok) {
    ok++;
    console.log(`✓ published ${req.manifest.name}@${req.version}`);
  } else if (res.status === 409) {
    // The store's first-write-wins guard: this (name, version) is already published
    // and immutable (e.g. a legacy row pinned at a pre-tag-resolution HEAD sha).
    // The server refusing to rewrite it is the doctrine working — for the publisher
    // that makes re-publishing idempotent, not an error. True content drift never
    // reaches this loop: release-publish's drift guard fails the run first.
    skipped++;
    console.log(`• ${req.manifest.name}@${req.version}: already published (immutable) — skipped`);
  } else {
    failed++;
    console.error(`✗ ${req.manifest.name}@${req.version}: ${res.status} ${await res.text()}`);
  }
}

console.log(`\nregistry:publish -> ${ok} published, ${skipped} already-published (skipped), ${failed} failed (${base})`);
if (failed) process.exit(1);
