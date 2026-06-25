// `bun run check:catalog` — the read-only catalog gate (no writes).
//
// Two invariants in one place:
//  1. Every plugin passes registry-core validation (the structural floor).
//  2. The committed .claude-plugin/marketplace.json byte-matches what deriveCatalog
//     produces — i.e. nobody hand-edited it and nobody forgot to re-derive.
// This is what CI runs; `bun run build:marketplace` is the local "fix it" command.

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { validateAll } from "@objectcore/registry-core";
import { loadWorkspace } from "./_workspace";

const root = join(import.meta.dir, "..");
const { plugins, catalog } = await loadWorkspace(root);

// 1. Structural validation.
const errors = (await validateAll(plugins, catalog)).filter((i) => i.level === "error");
for (const i of errors) console.error(`[error] ${i.plugin ? i.plugin + ": " : ""}${i.message}`);
if (errors.length) {
  console.error(`\n✗ ${errors.length} validation error(s).`);
  process.exit(1);
}

// 2. Sync check — must match GitFileSink's exact serialization.
const expected = JSON.stringify(catalog, null, 2) + "\n";
const committedPath = join(root, ".claude-plugin", "marketplace.json");
let committed = "";
try {
  committed = readFileSync(committedPath, "utf8");
} catch {
  /* missing — treated as out of date below */
}
if (committed !== expected) {
  console.error(
    "✗ .claude-plugin/marketplace.json is out of date or hand-edited — " +
      "run `bun run build:marketplace` and commit the result.",
  );
  process.exit(1);
}

console.log(`✓ ${plugins.length} plugin(s) valid; catalog in sync.`);
