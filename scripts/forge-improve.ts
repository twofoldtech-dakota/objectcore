// `bun run forge:improve` — the F7 admission-pipeline edge (plan 009 Phase 1).
//
// Gathers the proposed self-edit's changed paths, enforces the self-edit boundary
// (fail-fast — never runs the gate on a diff that reached the TCB), runs the full
// gate, and prints the admission verdict. Run it from the worktree where the
// `forge-improver` agent proposed a refinement to packages/forge/src/scaffold.ts.
//
// Usage:
//   bun run forge:improve                       # assess working-tree changes (vs HEAD)
//   bun run forge:improve --base <ref>           # assess committed changes <ref>..HEAD
//   bun run forge:improve --baseline <score.json> # also require non-regression vs an OQ4
//                                                 #   baseline (a dist/eval-score.json
//                                                 #   captured BEFORE the edit)
//
// Exit 0 = ADMITTED (boundary clean + gate green + no score regression). Exit 1 =
// REJECTED. Exit 2 = usage error. A human still reviews/merges (plan 009, Pillar 4).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decideAdmission, findBoundaryViolations, formatAdmission } from "@objectcore/forge";
import { compareScores, type EvalScore, type ScoreDelta } from "@objectcore/eval";

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

function flagValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  if (!v || v.startsWith("--")) {
    console.error(`${name} needs a value`);
    process.exit(2);
  }
  return v;
}

const root = join(import.meta.dir, "..");
const argv = process.argv.slice(2);
const base = flagValue(argv, "--base");
const baselinePath = flagValue(argv, "--baseline");
const changedPaths = base ? committedChanges(base) : workingChanges();

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

// OQ4: when a pre-edit baseline score is supplied, require the graded health not to
// regress (the gate just wrote the post-edit score to dist/eval-score.json).
let scoreDelta: ScoreDelta | undefined;
if (gateGreen && baselinePath) {
  try {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as EvalScore;
    const post = JSON.parse(
      readFileSync(join(root, "dist", "eval-score.json"), "utf8"),
    ) as EvalScore;
    scoreDelta = compareScores(baseline, post);
  } catch (e) {
    console.error(
      `\n(could not compute score delta: ${(e as Error).message}) — proceeding without it`,
    );
  }
}

const result = decideAdmission({ changedPaths, gateGreen, scoreDelta });
console.log("\n" + formatAdmission(result));
process.exit(result.admitted ? 0 : 1);
