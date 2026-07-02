// `bun run design:scaffold <brief.json> [--out <dir>] [--force]` — the deterministic
// half of /design. Takes a ScaffoldSpec (produced by the grill + plan phases), expands
// it into a complete accessible-by-construction DTCG token SSOT, then hands off to the
// shared tail (`scripts/_design.ts`): write the source (`*.tokens.json` + `resolver.json`
// + `system.json` + `evals/design.json`), derive the consumable views (`dist/tokens.css`,
// `dist/<theme>.tokens.json`), and print the self-gate. The judged eval (`runDesignEval`,
// needs a key) is the explicit next step.

import { join, relative } from "node:path";
import { readFileSync } from "node:fs";
import { scaffoldDesignSystem, type ScaffoldSpec } from "@objectcore/design";
import { writeSystemAndGate } from "./_design";

const specPath = process.argv[2];
if (!specPath || specPath.startsWith("--")) {
  console.error("usage: bun run design:scaffold <brief.json> [--out <dir>] [--force]");
  process.exit(2);
}
const force = process.argv.includes("--force");
const outFlag = process.argv.indexOf("--out");
const root = join(import.meta.dir, "..");

const spec = JSON.parse(readFileSync(specPath, "utf8")) as ScaffoldSpec;
const outDir = outFlag !== -1 && process.argv[outFlag + 1]
  ? join(root, process.argv[outFlag + 1]!)
  : join(root, "design", spec.brief.name);

const code = writeSystemAndGate(root, outDir, scaffoldDesignSystem(spec), {
  force,
  headline: `✓ scaffolded design system "${spec.brief.name}" -> ${relative(root, outDir)}`,
});
if (code === 2) process.exit(2);
console.log("Next: `runDesignEval` (the judged on-brand gate, needs an API key).");
if (code) process.exit(code);
