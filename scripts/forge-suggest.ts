// `bun run forge:suggest` — the F7 Phase 2 backlog surfacer (plan 009 Phase 2).
//
// Reads the generator (packages/forge/src/scaffold.ts) and prints the declared
// `forge:improvable` refinement candidates — the deterministic trigger surface an
// orchestrator (or a human) consults before delegating the `forge-improver` subagent.
// Read-only; it never proposes or edits anything.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scanImprovable } from "@objectcore/forge";

const root = join(import.meta.dir, "..");
const source = readFileSync(join(root, "packages", "forge", "src", "scaffold.ts"), "utf8");
const candidates = scanImprovable(source);

if (!candidates.length) {
  console.log("No declared refinement candidates in scaffold.ts (the backlog is empty).");
  process.exit(0);
}

console.log(
  `forge-improver backlog — ${candidates.length} declared Tier-A candidate(s) in scaffold.ts:\n`,
);
for (const c of candidates) {
  console.log(`  • scaffold.ts:${c.line} — ${c.reason}`);
}
console.log(
  "\nTo act on one: delegate the `forge-improver` subagent with the candidate, then\n" +
    "`bun run forge:improve` admits the result (boundary + meta-eval + full gate). A human merges.",
);
