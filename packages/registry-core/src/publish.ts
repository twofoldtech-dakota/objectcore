// Self-service publish (POST /v1/plugins) — the heaviest write path: the HTTP
// analogue of the release pipeline. Ports + adapters, the same shape as the catalog
// sources/sinks and the eval Judge: an `OidcVerifier` port (MockOidcVerifier for
// gate tests; GitHubOidcVerifier for the live path), a pure `authorizePollicy`/
// `parsePublish`, and a `toStoredPlugin` that hands the result to the `CatalogStore`
// write port. The provenance gate is re-enforced at the route (registry-server),
// reusing @objectcore/release's `requiresProvenance` so the rule is single-sourced.
//
// The server NEVER re-runs git: the publisher (release CI, holding a GitHub Actions
// OIDC token) supplies the manifest + pin coordinates it already computed. The `ref`
// is recomputed server-side via `releaseTag` — not trusted from the client.

import type { PluginManifest, WorkspacePlugin } from "./types";
import type { StoredPlugin } from "./sources";
import { validateSchema } from "./schema";
import { releaseTag } from "./tags";

// ── OIDC verification (the port + two adapters) ────────────────────────────────

/** The verified claims we care about. GitHub Actions tokens carry many more; this is
 *  the subset the publish policy checks. Index signature keeps the rest accessible. */
export interface OidcClaims {
  iss: string;
  aud: string;
  /** "owner/repo" the workflow ran in. */
  repository?: string;
  /** e.g. "repo:owner/repo:ref:refs/heads/main". */
  sub?: string;
  exp?: number;
  nbf?: number;
  [k: string]: unknown;
}

/** The verifier port: turn a bearer token into trusted claims, or throw. */
export interface OidcVerifier {
  verify(token: string): Promise<OidcClaims>;
}

/** Deterministic, offline verifier for tests / CI without a live IdP — the publish
 *  analogue of MockJudge / InMemoryCatalogStore. Maps known tokens to claims. */
export class MockOidcVerifier implements OidcVerifier {
  constructor(private readonly fixture: Record<string, OidcClaims> = {}) {}
  async verify(token: string): Promise<OidcClaims> {
    const claims = this.fixture[token];
    if (!claims) throw new Error("MockOidcVerifier: unknown token");
    return claims;
  }
}

/** Minimal JWK shape (Bun's types don't expose a `JsonWebKey` global; importKey
 *  structurally checks the object). */
interface Jwk {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
  [k: string]: unknown;
}

// Returns an ArrayBuffer-backed view (no annotation -> Uint8Array<ArrayBuffer>, which
// crypto.subtle.verify's BufferSource param requires).
function b64urlToBytes(s: string) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64urlToString(s: string): string {
  return new TextDecoder().decode(b64urlToBytes(s));
}

/** The live verifier: validates a GitHub Actions OIDC JWT (RS256) against the
 *  issuer's JWKS via Web Crypto — no JWT dependency (registry-core stays dep-free,
 *  the same posture as the hand-rolled schema check). Network path, so it is wired in
 *  prod but not unit-tested (like AnthropicJudge). Fails CLOSED: any malformed token,
 *  unknown key, bad signature, wrong alg, or expiry throws -> the route returns 401.
 *  iss/aud/repository are checked by {@link authorizePublish}, not here. */
export class GitHubOidcVerifier implements OidcVerifier {
  private jwks: { at: number; keys: Jwk[] } | null = null;

  constructor(
    private readonly issuer = "https://token.actions.githubusercontent.com",
    private readonly jwksTtlMs = 10 * 60 * 1000,
  ) {}

  private async keys(): Promise<Jwk[]> {
    const now = Date.now();
    if (this.jwks && now - this.jwks.at < this.jwksTtlMs) return this.jwks.keys;
    const res = await fetch(`${this.issuer.replace(/\/+$/, "")}/.well-known/jwks`);
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    const body = (await res.json()) as { keys: Jwk[] };
    this.jwks = { at: now, keys: body.keys };
    return body.keys;
  }

  async verify(token: string): Promise<OidcClaims> {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("malformed JWT");
    const [h, p, sig] = parts;

    const header = JSON.parse(b64urlToString(h)) as { alg?: string; kid?: string };
    if (header.alg !== "RS256") throw new Error(`unsupported alg: ${header.alg}`); // reject none/HS*

    const jwk = (await this.keys()).find((k) => k.kid === header.kid);
    if (!jwk) throw new Error(`unknown kid: ${header.kid}`);

    const key = await crypto.subtle.importKey(
      "jwk",
      { ...jwk, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlToBytes(sig),
      new TextEncoder().encode(`${h}.${p}`),
    );
    if (!ok) throw new Error("signature verification failed");

    const claims = JSON.parse(b64urlToString(p)) as OidcClaims;
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof claims.exp === "number" && nowSec >= claims.exp) throw new Error("token expired");
    if (typeof claims.nbf === "number" && nowSec < claims.nbf) throw new Error("token not yet valid");
    return claims;
  }
}

// ── Authorization policy (pure) ────────────────────────────────────────────────

/** Who may publish: a token from the expected issuer + audience whose `repository`
 *  claim is allowlisted. Configured from env in prod.ts (inert until set). */
export interface PublishPolicy {
  issuer: string;
  audience: string;
  allowedRepositories: string[];
}

export type AuthzResult = { ok: true } | { ok: false; error: string };

/** Pure check of verified claims against the policy. Rejects an absent repository
 *  claim (can't authorize what we can't identify) — fail closed. */
export function authorizePublish(claims: OidcClaims, policy: PublishPolicy): AuthzResult {
  if (claims.iss !== policy.issuer) return { ok: false, error: "untrusted issuer" };
  if (claims.aud !== policy.audience) return { ok: false, error: "wrong audience" };
  const repo = typeof claims.repository === "string" ? claims.repository : undefined;
  if (!repo) return { ok: false, error: "missing repository claim" };
  if (!policy.allowedRepositories.includes(repo)) {
    return { ok: false, error: `repository not allowed: ${repo}` };
  }
  return { ok: true };
}

// ── Request shape + strict parse (pure) ────────────────────────────────────────

/** The publish request body. `ref` is intentionally NOT accepted — it is recomputed
 *  from name+version. `bundlesMcp` lets the publisher declare a root `.mcp.json` the
 *  server can't see (the disk half of the provenance gate). */
export interface PublishRequest {
  manifest: PluginManifest;
  relDir: string;
  version: string;
  sha: string;
  repoUrl: string;
  channel?: string;
  bundlesMcp?: boolean;
  provenance?: unknown;
}

export interface ValidatedPublish {
  manifest: PluginManifest;
  relDir: string;
  version: string;
  sha: string;
  ref: string;
  repoUrl: string;
  channel: string;
  bundlesMcp: boolean;
  provenance?: unknown;
}

export type PublishParseResult =
  | { ok: true; value: ValidatedPublish }
  | { ok: false; error: string };

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX_SHA = /^[0-9a-f]{7,64}$/i;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ALLOWED = new Set(["manifest", "relDir", "version", "sha", "repoUrl", "channel", "bundlesMcp", "provenance"]);

/** Strict, pure validation/shaping of an untrusted publish body. Reuses the catalog's
 *  `validateSchema` so the published manifest faces the SAME strict floor as a
 *  Git-sourced one (unknown fields + wrong types rejected). Never throws. */
export function parsePublish(input: unknown): PublishParseResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "publish request must be a JSON object" };
  }
  const o = input as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!ALLOWED.has(k)) return { ok: false, error: `unknown field: ${k}` };
  }

  if (typeof o.manifest !== "object" || o.manifest === null || Array.isArray(o.manifest)) {
    return { ok: false, error: "manifest must be an object" };
  }
  const manifest = o.manifest as PluginManifest;
  if (typeof manifest.name !== "string" || !KEBAB.test(manifest.name)) {
    return { ok: false, error: "manifest.name must be a kebab-case string" };
  }
  if (typeof o.relDir !== "string" || !KEBAB.test(o.relDir)) {
    return { ok: false, error: "relDir must be a kebab-case string" };
  }
  // Same strict manifest floor as the catalog (single-sourced).
  const wp: WorkspacePlugin = { manifest, dir: "", relDir: o.relDir };
  const schemaErrs = validateSchema([wp]).filter((i) => i.level === "error");
  if (schemaErrs.length) {
    return { ok: false, error: `manifest: ${schemaErrs.map((e) => e.message).join("; ")}` };
  }

  if (typeof o.version !== "string" || !SEMVER.test(o.version)) {
    return { ok: false, error: "version must be a semver string" };
  }
  if (manifest.version !== undefined && manifest.version !== o.version) {
    return { ok: false, error: "manifest.version must match the published version" };
  }
  if (typeof o.sha !== "string" || !HEX_SHA.test(o.sha)) {
    return { ok: false, error: "sha must be a hex commit sha" };
  }
  if (typeof o.repoUrl !== "string" || !/^https?:\/\//.test(o.repoUrl)) {
    return { ok: false, error: "repoUrl must be an http(s) URL" };
  }

  let channel = "stable";
  if (o.channel !== undefined) {
    if (typeof o.channel !== "string" || !KEBAB.test(o.channel)) {
      return { ok: false, error: "channel must be a kebab-case string" };
    }
    channel = o.channel;
  }
  let bundlesMcp = false;
  if (o.bundlesMcp !== undefined) {
    if (typeof o.bundlesMcp !== "boolean") return { ok: false, error: "bundlesMcp must be a boolean" };
    bundlesMcp = o.bundlesMcp;
  }

  return {
    ok: true,
    value: {
      manifest,
      relDir: o.relDir,
      version: o.version,
      sha: o.sha,
      ref: releaseTag(manifest.name, o.version), // server-computed, not trusted
      repoUrl: o.repoUrl,
      channel,
      bundlesMcp,
      provenance: o.provenance,
    },
  };
}

/** The validated publish as the `CatalogStore` write port stores it — the same
 *  `StoredPlugin` shape `RegistryDbSink` produces, so reads re-derive identically.
 *  This finally populates the long-unused `provenance` column. */
export function toStoredPlugin(v: ValidatedPublish): StoredPlugin {
  return {
    manifest: v.manifest,
    relDir: v.relDir,
    version: v.version,
    sha: v.sha,
    ref: v.ref,
    repoUrl: v.repoUrl,
    provenance: v.provenance,
  };
}
