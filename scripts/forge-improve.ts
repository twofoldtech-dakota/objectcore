// `bun run forge:improve` — the F7 admission-pipeline edge (plan 009 Phase 1).
//
// Gathers the proposed self-edit's changed paths, enforces the self-edit boundary
// (fail-fast — never runs the gate on a diff that reached the TCB), runs the full
// gate, and prints the admission verdict. Run it from the worktree where the
// `forge-improver` agent proposed a refinement to packages/forge/src/scaffold.ts.
//
// Usage:
//   bun run forge:improve                # assess working-tree changes (vs HEAD)
//   bun run forge:improve --base <ref>    # assess committed changes <ref>..HEAD
//
// Exit 0 = ADMITTED (boundary clean + gate green; a human still reviews/merges).
// Exit 1 = REJECTED. Exit 2 = usage error.

import { execFileSync } from "node:child_process";
import {
  decideAdmission,
  findBoundaryViolations,
  formatAdmission,
} from "@objectcore/forge";

function workingChanges(): string[] {
  // Porcelain v1: 2 status chars + a space, then the path (untracked => "?? path").
  const out = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" });
  return out
    .split("\n")
    .map((l) => l.slice(3).trim())
    .filter(Boolean);
}

function committedChanges(base: string): string[] {
  const out = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
    encoding: "utf8",
  });
  return out.split("\n").map((l) => l.trim()).filter(Boolean);
}

const argv = process.argv.slice(2);
const baseIdx = argv.indexOf("--base");
let changedPaths: string[];
if (baseIdx !== -1) {
  const base = argv[baseIdx + 1];
  if (!base) {
    console.error("--base needs a ref, e.g. --base main");
    process.exit(2);
  }
  changedPaths = committedChanges(base);
} else {
  changedPaths = workingChanges();
}

if (!changedPaths.length) {
  console.log("No changed paths — nothing to admit.");
  process.exit(0);
}

// Boundary first: fail fast, and never run the gate on a diff that reached the TCB.
const violations = findBoundaryViolations(changedPaths);
if (violations.length) {
  console.log(formatAdmission(decideAdmission({ changedPaths, gateGreen: null })));
  process.exit(1);
}

console.log(
  `Boundary OK — ${changedPaths.length} changed path(s) within the mutable surface. Running the full gate...\n`,
);
let gateGreen = true;
try {
  execFileSync("bun", ["run", "check"], { stdio: "inherit" });
} catch {
  gateGreen = false;
}

const result = decideAdmission({ changedPaths, gateGreen });
console.log("\n" + formatAdmission(result));
process.exit(result.admitted ? 0 : 1);
