// `bun run release:status` — read-only preview of the pending release (like
// `changeset status`). Lists what release-version would bump and flags changesets
// that name an unknown plugin. Exits non-zero on an unknown plugin.

import { join } from "node:path";
import { planRelease } from "@objectcore/release";
import { loadWorkspace } from "./_workspace";
import { readChangesets } from "./_release";

const root = join(import.meta.dir, "..");
const { plugins } = await loadWorkspace(root);
const changesets = await readChangesets(root);

if (!changesets.length) {
  console.log("No changesets — nothing pending. (Add one under .changeset/ to stage a release.)");
  process.exit(0);
}

const plan = planRelease(
  plugins.map((p) => ({ name: p.manifest.name, version: p.manifest.version ?? "0.0.0" })),
  changesets,
);

for (const u of plan.unknown) {
  console.error(`[error] changeset ${u.changeset} names unknown plugin "${u.plugin}"`);
}

console.log(`Pending release — ${plan.releases.length} plugin(s) from ${changesets.length} changeset(s):`);
for (const r of plan.releases) {
  console.log(`  ${r.name}: ${r.oldVersion} -> ${r.newVersion} (${r.bump})`);
}

if (plan.unknown.length) process.exit(1);
