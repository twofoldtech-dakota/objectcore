// F7 Phase 1 — the eval-gated admission pipeline (plan 009, Pillar 2 + Pillar 4).
//
// A forge self-edit (a proposed change to the mutable surface — scaffold.ts) is
// ADMITTED only if it clears, in order:
//   1. the boundary  — it touches nothing in the TCB (boundary.ts);
//   2. the meta-eval — the golden corpus stays byte-stable AND the guard corpus
//      still rejects (both run inside `bun run check` via `bun test`);
//   3. the full gate — `bun run check` is green (tsc + catalog + kb + tests + eval).
//
// This module owns the pure admission DECISION; scripts/forge-improve.ts is the I/O
// edge that gathers the diff, runs the gate, and feeds the verdict back here. Being
// the thing that decides the optimizer's OWN admission, this file is part of the TCB
// (see boundary.ts) — a self-edit may never touch it.

import type { ScoreDelta } from "@objectcore/eval";
import { findBoundaryViolations, type BoundaryViolation } from "./boundary";

/** The ordered checks a forge self-edit must clear (plan 009 Pillar 2). Kept as data
 *  so the CLI, the agent's prompt, and the tests share one source of truth. */
export const ADMISSION_CHECKS = [
  {
    id: "boundary",
    what: "touches only the mutable surface (scaffold.ts); never the gate, seam, spec contract, or corpus",
  },
  {
    id: "meta-eval",
    what: "golden corpus stays byte-stable AND the guard corpus still rejects (bun test)",
  },
  {
    id: "full-gate",
    what: "`bun run check` is green (tsc + catalog + kb + tests + eval)",
  },
  {
    id: "no-regression",
    what: "the graded gate-health score did not regress vs the pre-edit baseline (open question 4; only when a baseline is supplied)",
  },
] as const;

export interface AdmissionInput {
  /** Repo-relative paths the proposed self-edit changed. */
  changedPaths: string[];
  /** Did `bun run check` pass? `null` = not run (boundary short-circuited it). */
  gateGreen: boolean | null;
  /** Optional graded-health delta (pre-edit → post-edit). When present and `regressed`,
   *  the self-edit is rejected even though the gate is green — it made the gate worse
   *  (a new fragile green, lower confidence margin). The OQ4 signal. */
  scoreDelta?: ScoreDelta;
}

export interface AdmissionResult {
  admitted: boolean;
  boundaryViolations: BoundaryViolation[];
  gateGreen: boolean | null;
  scoreDelta?: ScoreDelta;
  /** Why it was rejected (empty when admitted). */
  reasons: string[];
}

/** Pure: decide admissibility. Admitted iff there is NO boundary violation, the gate
 *  is green, AND (when a baseline score is supplied) the graded health did not regress.
 *  The boundary is sufficient to reject on its own — a diff that reaches the TCB is
 *  never admitted regardless of the gate result. */
export function decideAdmission(input: AdmissionInput): AdmissionResult {
  const boundaryViolations = findBoundaryViolations(input.changedPaths);
  const reasons: string[] = [];
  if (boundaryViolations.length) {
    reasons.push(`${boundaryViolations.length} path(s) outside the mutable surface (boundary)`);
  }
  if (input.gateGreen === false) reasons.push("the full gate (`bun run check`) is red");
  if (input.gateGreen === null && boundaryViolations.length === 0) {
    reasons.push("the full gate was not run");
  }
  const regressed = input.scoreDelta?.verdict === "regressed";
  if (regressed) {
    reasons.push(
      `the gate-health score regressed vs baseline ` +
        `(Δhealth ${input.scoreDelta!.healthDelta.toFixed(3)}, ` +
        `Δfailed ${input.scoreDelta!.failedDelta}, Δnear-miss ${input.scoreDelta!.nearMissDelta})`,
    );
  }
  const admitted =
    boundaryViolations.length === 0 && input.gateGreen === true && !regressed;
  return { admitted, boundaryViolations, gateGreen: input.gateGreen, scoreDelta: input.scoreDelta, reasons };
}

/** A human/agent-readable verdict. */
export function formatAdmission(r: AdmissionResult): string {
  const scoreLine =
    r.scoreDelta &&
    ` Score ${r.scoreDelta.verdict} (Δhealth ${r.scoreDelta.healthDelta.toFixed(3)}).`;
  if (r.admitted) {
    return (
      "✓ self-edit ADMITTED — boundary clean and the full gate is green." +
      (scoreLine ?? "") +
      " A human reviews/merges (plan 009, Pillar 4)."
    );
  }
  const lines = ["✗ self-edit REJECTED:"];
  for (const reason of r.reasons) lines.push(`  - ${reason}`);
  for (const v of r.boundaryViolations) lines.push(`    ✗ ${v.path} [${v.zone}] — ${v.reason}`);
  return lines.join("\n");
}
