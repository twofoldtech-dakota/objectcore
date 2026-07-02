// `bun run release:version [--dry-run]` — the "version" half of the release (what
// CI runs to produce the Version PR). Consumes the pending changesets:
//   1. bump each released plugin's plugin.json version
//   2. keep its evals/output.json `expectEntry.version` in lockstep (so the output
//      eval still passes after the bump)
//   3. prepend its CHANGELOG.md
//   4. re-derive marketplace.json through the SAME deriveCatalog seam + validate
//   5. delete the consumed changeset files — LAST, so a failed validation never
//      strands a half-applied release with the intent record (the changesets) gone
// Tagging/SHA-pinning happen later, in release-publish, after this is merged.

import { join } from "node:path";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { GitFileSink, validateAll } from "@objectcore/registry-core";
import { planRelease, renderChangelogEntry, prependChangelog } from "@objectcore/release";
import { loadWorkspace } from "./_workspace";
import { readChangesets, setJsonVersion, CHANGESET_DIR } from "./_release";

const root = join(import.meta.dir, "..");
const dryRun = process.argv.includes("--dry-run");

const ws = await loadWorkspace(root);
const changesets = await readChangesets(root);
if (!changesets.length) {
  console.log("No changesets — nothing to version.");
  process.exit(0);
}

const plan = planRelease(
  ws.plugins.map((p) => ({ name: p.manifest.name, version: p.manifest.version ?? "0.0.0" })),
  changesets,
);
if (plan.unknown.length) {
  for (const u of plan.unknown) {
    console.error(`[error] changeset ${u.changeset} names unknown plugin "${u.plugin}"`);
  }
  console.error("\n✗ fix the changeset(s) above — plugin names must match a plugin dir.");
  process.exit(1);
}
if (!plan.releases.length) {
  console.log("Changesets present but no plugin matched — nothing to version.");
  process.exit(0);
}

const byName = new Map(ws.plugins.map((p) => [p.manifest.name, p]));
for (const r of plan.releases) {
  const plugin = byName.get(r.name);
  if (!plugin) continue;
  console.log(`${r.name}: ${r.oldVersion} -> ${r.newVersion} (${r.bump})`);
  if (dryRun) continue;

  // 1. plugin.json version (minimal in-place edit to keep the diff clean)
  const manifestPath = join(plugin.dir, ".claude-plugin", "plugin.json");
  await writeFile(manifestPath, setJsonVersion(await readFile(manifestPath, "utf8"), r.newVersion), "utf8");

  // 2. evals/output.json expectEntry.version, if it pins one. Only a MISSING file is
  // fine to skip; a malformed or unwritable one must fail loudly — silently skipping
  // ships a bumped plugin.json with a stale expectEntry.version, and the red surfaces
  // later as a confusing output-eval mismatch far from the cause.
  const outPath = join(plugin.dir, "evals", "output.json");
  let rawSpec: string | null = null;
  try {
    rawSpec = await readFile(outPath, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  if (rawSpec !== null) {
    let spec: { expectEntry?: Record<string, unknown> };
    try {
      spec = JSON.parse(rawSpec) as { expectEntry?: Record<string, unknown> };
    } catch (e) {
      console.error(`✗ ${outPath} is not valid JSON — cannot keep expectEntry.version in lockstep: ${(e as Error).message}`);
      console.error("  restore the applied edits with `git checkout -- plugins/`, fix the file, and re-run.");
      process.exit(1);
    }
    if (spec.expectEntry && "version" in spec.expectEntry) {
      spec.expectEntry.version = r.newVersion;
      await writeFile(outPath, JSON.stringify(spec, null, 2) + "\n", "utf8");
    }
  }

  // 3. CHANGELOG.md
  const clPath = join(plugin.dir, "CHANGELOG.md");
  let existing = "";
  try {
    existing = await readFile(clPath, "utf8");
  } catch {
    /* first release */
  }
  await writeFile(clPath, prependChangelog(existing, renderChangelogEntry(r), r.name), "utf8");
}

if (dryRun) {
  console.log("\n(dry run — no files changed)");
  process.exit(0);
}

// 4. re-derive + validate + write (single derivation path)
const after = await loadWorkspace(root);
const errors = (await validateAll(after.plugins, after.catalog)).filter((i) => i.level === "error");
if (errors.length) {
  for (const i of errors) console.error(`[error] ${i.plugin ? i.plugin + ": " : ""}${i.message}`);
  console.error("\n✗ validation failed after versioning — marketplace.json NOT written.");
  console.error("  plugin.json/CHANGELOG edits were already applied (the changesets were NOT deleted);");
  console.error("  restore with `git checkout -- .` before re-running, or a re-run would double-bump.");
  process.exit(1);
}
await new GitFileSink(join(root, ".claude-plugin", "marketplace.json")).publish(after.catalog);

// 5. consume the changesets — the last, safest step: the intent record survives any
// failure above, so recovery is always `git checkout` + re-run.
for (const cs of changesets) {
  await unlink(join(root, CHANGESET_DIR, `${cs.id}.md`));
}
console.log(`\n✓ versioned ${plan.releases.length} plugin(s); catalog re-derived. Commit the result.`);
