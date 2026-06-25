// `bun run release:publish [--dry-run]` — the "publish" half of the release (what
// CI runs once the Version PR is merged and no changesets remain):
//   1. provenance gate — refuse to publish an MCP-bundling plugin without attestation
//   2. tag each plugin at its current version (`{plugin}--v{semver}`) if not already
//   3. SHA-pin EVERY plugin to the release commit and derive an immutable pinned
//      catalog (git-subdir sources) -> dist/marketplace.pinned.json, the publish artifact
// CI then pushes the tags and attests the pinned catalog (actions/attest-build-provenance).
// The committed .claude-plugin/marketplace.json is never touched here — pins are a
// publish-time view, so check:catalog stays green.

import { join } from "node:path";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { deriveCatalog, releaseTag } from "@objectcore/registry-core";
import { requiresProvenance } from "@objectcore/release";
import { loadWorkspace, deriveOptsFromConfig } from "./_workspace";
import { git, gitSha, existingTags, repoUrl, hasMcpConfig } from "./_release";

const root = join(import.meta.dir, "..");
const dryRun = process.argv.includes("--dry-run");
const attested = process.argv.includes("--attested") || process.env.OBJECTCORE_ATTESTED === "1";

const { plugins, cfg } = await loadWorkspace(root);
const sha = gitSha(root);
const tags = existingTags(root);
const url = repoUrl(root);

// 1. provenance gate (AGENTS.md: MCP bundle == managed credential).
const needsProvenance: string[] = [];
for (const p of plugins) {
  if (requiresProvenance(p.manifest) || (await hasMcpConfig(p.dir))) {
    needsProvenance.push(p.manifest.name);
  }
}
if (needsProvenance.length && !attested) {
  console.error(`✗ these plugins bundle MCP and need provenance before publish: ${needsProvenance.join(", ")}`);
  console.error("  publish under attestation (CI sets OBJECTCORE_ATTESTED=1; or pass --attested).");
  process.exit(1);
}

// 2. tag plugins whose current version is not yet tagged (idempotent).
const versioned = plugins.filter((p) => p.manifest.version);
const toTag = versioned
  .map((p) => ({
    name: p.manifest.name,
    version: p.manifest.version as string,
    tag: releaseTag(p.manifest.name, p.manifest.version as string),
  }))
  .filter((t) => !tags.has(t.tag));

for (const t of toTag) {
  console.log(`tag ${t.tag} -> ${sha.slice(0, 12)}`);
  if (!dryRun) git(root, ["tag", "-a", t.tag, "-m", `${t.name} v${t.version}`]);
}
if (!toTag.length) console.log("No new versions to tag.");

// 3. SHA-pinned catalog (the publish artifact). git-subdir needs a remote URL.
if (!url) {
  console.error("✗ no `origin` remote — cannot build SHA-pinned git-subdir sources.");
  process.exit(1);
}
const shaPin = Object.fromEntries(versioned.map((p) => [p.manifest.name, sha]));
const pinned = deriveCatalog(plugins, { ...deriveOptsFromConfig(cfg), shaPin, repoUrl: url });

const outPath = join(root, "dist", "marketplace.pinned.json");
if (!dryRun) {
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(outPath, JSON.stringify(pinned, null, 2) + "\n", "utf8");
}
console.log(`\n✓ pinned catalog -> dist/marketplace.pinned.json (sha ${sha.slice(0, 12)})`);

// Hand the created tags to the CI workflow so it can push them.
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `tags=${toTag.map((t) => t.tag).join(" ")}\n`);
  await appendFile(process.env.GITHUB_OUTPUT, `tag_count=${toTag.length}\n`);
}
if (dryRun) console.log("\n(dry run — no tags created, no artifact written)");
