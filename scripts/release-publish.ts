// `bun run release:publish [--dry-run] [--allow-dirty]` — the "publish" half of the
// release (what CI runs once the Version PR is merged and no changesets remain):
//   0. clean-tree assertion — the pinned catalog is derived from the WORKING TREE while
//      pins resolve to commits; uncommitted edits would ship content the pin sha does
//      not contain. `--allow-dirty` is the documented escape hatch (dry runs are exempt).
//   1. provenance gate — refuse to publish an MCP-bundling plugin without attestation
//   2. tag each plugin at its current version (`{plugin}--v{semver}`) if not already
//   3. SHA-pin EVERY plugin to the commit its RELEASE TAG resolves to (never bare HEAD)
//      and derive an immutable pinned catalog (git-subdir sources)
//      -> dist/marketplace.pinned.json, the publish artifact
// CI then pushes the tags and attests the pinned catalog (actions/attest-build-provenance).
// The committed .claude-plugin/marketplace.json is never touched here — pins are a
// publish-time view, so check:catalog stays green.

import { join } from "node:path";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { deriveCatalog, releaseTag } from "@objectcore/registry-core";
import { requiresProvenance } from "@objectcore/release";
import { loadWorkspace, deriveOptsFromConfig } from "./_workspace";
import { git, gitSha, existingTags, repoUrl, hasMcpConfig, tagSha, pathChangedSince } from "./_release";

const root = join(import.meta.dir, "..");
const dryRun = process.argv.includes("--dry-run");
const attested = process.argv.includes("--attested") || process.env.OBJECTCORE_ATTESTED === "1";
const allowDirty = process.argv.includes("--allow-dirty");

// 0. clean-tree assertion (tracked files only — `-uno` ignores untracked scratch).
if (!dryRun && !allowDirty) {
  const dirty = git(root, ["status", "--porcelain", "-uno"]);
  if (dirty) {
    console.error("✗ working tree has uncommitted changes — the pin sha would not contain them:");
    console.error(dirty.split("\n").map((l) => `    ${l}`).join("\n"));
    console.error("  commit first, or pass --allow-dirty to publish anyway.");
    process.exit(1);
  }
}

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
// A version-less plugin cannot be tagged or pinned — it would ship as a bare-path
// entry in the pinned catalog, which the DB sink rejects mid-ingest. Fail here,
// at the publisher, where the fix (add a version) is obvious.
const versioned = plugins.filter((p) => p.manifest.version);
if (versioned.length !== plugins.length) {
  const unversioned = plugins.filter((p) => !p.manifest.version).map((p) => p.manifest.name);
  console.error(`✗ plugin(s) without a version cannot be published: ${unversioned.join(", ")}`);
  console.error("  add a `version` to plugin.json (and a changeset) before publishing.");
  process.exit(1);
}
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

// Pin each plugin to the commit its release tag resolves to — never bare HEAD. A tag
// created in this run sits at HEAD (create-tag-then-resolve keeps first publish
// correct); a pre-existing tag keeps the pin exactly where the version was cut, so a
// post-release push to main cannot drift the "immutable" pin away from its ref.
// Content that changed since the tag without a changeset fails loudly instead of
// shipping under the old version.
const createdNow = new Set(toTag.map((t) => t.tag));
const shaPin: Record<string, string> = {};
const drifted: string[] = [];
for (const p of versioned) {
  const name = p.manifest.name;
  const tag = releaseTag(name, p.manifest.version as string);
  // In a dry run the new tag was never created; it would be created at HEAD.
  const pinnedSha = dryRun && createdNow.has(tag) ? sha : tagSha(root, tag);
  shaPin[name] = pinnedSha;
  if (!createdNow.has(tag) && pinnedSha !== sha && pathChangedSince(root, pinnedSha, `plugins/${p.relDir}`)) {
    drifted.push(`  ${name}: plugins/${p.relDir} changed since ${tag}`);
  }
}
if (drifted.length) {
  console.error("✗ plugin content changed since its release tag — add a changeset and version first:");
  for (const d of drifted) console.error(d);
  process.exit(1);
}

const pinned = deriveCatalog(plugins, { ...deriveOptsFromConfig(cfg), shaPin, repoUrl: url });

const outPath = join(root, "dist", "marketplace.pinned.json");
if (!dryRun) {
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(outPath, JSON.stringify(pinned, null, 2) + "\n", "utf8");
}
console.log(`\n✓ pinned catalog -> dist/marketplace.pinned.json (release commit ${sha.slice(0, 12)}, pins resolved per tag)`);

// Hand the created tags to the CI workflow so it can push them.
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `tags=${toTag.map((t) => t.tag).join(" ")}\n`);
  await appendFile(process.env.GITHUB_OUTPUT, `tag_count=${toTag.length}\n`);
}
if (dryRun) console.log("\n(dry run — no tags created, no artifact written)");
