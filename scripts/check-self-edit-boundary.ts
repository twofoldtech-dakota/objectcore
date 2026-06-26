// `bun run scripts/check-self-edit-boundary.ts` — the F7 self-edit boundary CLI
// (plan 009, Pillar 1). Given the set of files a proposed forge self-edit touches,
// it FAILS if any path leaves the mutable surface (the generative logic in
// scaffold.ts) and reaches the trusted computing base (the gate, the seam, the
// spec contract, the meta-eval corpus).
//
// DELIBERATELY NOT part of `bun run check`: humans edit the TCB legitimately every
// day (that is how F2–F6 landed). This guard applies ONLY to an *automated*
// self-edit proposal, so it is invoked by the future proposer flow, not the general
// gate. Its *unit tests* (packages/forge/test/boundary.test.ts) run in the gate;
// the CLI does not.
//
// Usage:
//   check-self-edit-boundary.ts <path> [<path> ...]   # classify these paths
//   check-self-edit-boundary.ts --base <ref>          # diff <ref>..HEAD via git

import { execFileSync } from "node:child_process";
import { findBoundaryViolations } from "@objectcore/forge";

const argv = process.argv.slice(2);

function diffPaths(base: string): string[] {
  const out = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
    encoding: "utf8",
  });
  return out.split("\n").map((l) => l.trim()).filter(Boolean);
}

let paths: string[];
const baseIdx = argv.indexOf("--base");
if (baseIdx !== -1) {
  const base = argv[baseIdx + 1];
  if (!base) {
    console.error("--base needs a ref, e.g. --base main");
    process.exit(2);
  }
  paths = diffPaths(base);
} else if (argv.length) {
  paths = argv;
} else {
  console.error(
    "usage: check-self-edit-boundary.ts <path>... | --base <ref>\n" +
      "  (no paths given — nothing to check)",
  );
  process.exit(2);
}

if (!paths.length) {
  console.log("✓ no changed paths — self-edit boundary trivially satisfied.");
  process.exit(0);
}

const violations = findBoundaryViolations(paths);
if (violations.length) {
  console.error(
    `✗ self-edit boundary violated — ${violations.length} path(s) outside the mutable surface:`,
  );
  for (const v of violations) console.error(`  ✗ ${v.path} [${v.zone}] — ${v.reason}`);
  console.error(
    "\nA forge self-edit may only touch packages/forge/src/scaffold.ts. The gate, the\n" +
      "seam, the spec contract, and the meta-eval corpus are off-limits (plan 009).",
  );
  process.exit(1);
}

console.log(`✓ ${paths.length} changed path(s) within the mutable surface — boundary OK.`);
