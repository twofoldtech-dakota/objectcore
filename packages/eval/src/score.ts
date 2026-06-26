// Open question 4 — the measurement primitive: turn the binary gate into a GRADED,
// comparable health signal so "did an intervention actually help?" is measurable, not
// just "did it still pass?". A forge-improver refinement (F7) or a captured KB lesson
// should raise — or at least not lower — this score; the autonomous loop's missing
// piece is exactly a number it can compare before vs after.
//
// Pure (no I/O), like buildEvidence: scoreReport distills an EvalReport into an
// EvalScore; compareScores yields a verdict. scripts/eval.ts writes the score each run
// to dist/eval-score.json, and the forge admission pipeline can require non-regression.
//
// Graceful degradation: the confidence-bearing signal (activation/delegation) only
// exists when the judge ran (an API key is present). With no graded results the score
// still reflects the deterministic layers (pass/fail counts); confidenceMargin is null.

import type { EvalReport } from "./types";
import { NEAR_MISS_THRESHOLD } from "./evidence";

/** A graded summary of one gate run — richer than green/red. */
export interface EvalScore {
  passed: number;
  failed: number;
  warnings: number;
  /** Passed routes whose confidence is at/below the near-miss threshold (fragile greens). */
  nearMisses: number;
  /** Count of confidence-bearing results (activation + delegation); 0 when the judge didn't run. */
  graded: number;
  /** Mean (confidence − threshold) over graded PASSES — headroom above the firing line.
   *  Higher is healthier. null when nothing was graded. */
  confidenceMargin: number | null;
  /** 0..1 composite: full passes count, failures and fragile greens cost. */
  health: number;
}

export interface ScoreOpts {
  nearMissThreshold?: number;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** Distill a report into a graded score. Deterministic for a given report. */
export function scoreReport(report: EvalReport, opts: ScoreOpts = {}): EvalScore {
  const threshold = opts.nearMissThreshold ?? NEAR_MISS_THRESHOLD;
  const graded = report.results.filter((r) => typeof r.confidence === "number");
  const gradedPasses = graded.filter((r) => r.passed);
  const nearMisses = gradedPasses.filter((r) => (r.confidence as number) <= threshold).length;

  const confidenceMargin =
    gradedPasses.length === 0
      ? null
      : gradedPasses.reduce((sum, r) => sum + ((r.confidence as number) - threshold), 0) /
        gradedPasses.length;

  const total = report.passed + report.failed;
  // Full passes are worth 1; a fragile green is worth half. Failures pull the ratio down.
  const health = clamp01((report.passed - 0.5 * nearMisses) / Math.max(1, total));

  return {
    passed: report.passed,
    failed: report.failed,
    warnings: report.warnings,
    nearMisses,
    graded: graded.length,
    confidenceMargin,
    health,
  };
}

/** The direction an intervention moved the gate. */
export type ScoreVerdict = "improved" | "unchanged" | "regressed";

export interface ScoreDelta {
  verdict: ScoreVerdict;
  healthDelta: number;
  failedDelta: number;
  nearMissDelta: number;
  /** after − before for confidenceMargin; null if either side is ungraded. */
  marginDelta: number | null;
}

/** Compare two scores (before → after an intervention). Any NEW failure is a regression
 *  outright; otherwise health decides, with a small epsilon so noise reads as unchanged. */
export function compareScores(before: EvalScore, after: EvalScore): ScoreDelta {
  const eps = 1e-9;
  const failedDelta = after.failed - before.failed;
  const healthDelta = after.health - before.health;
  const nearMissDelta = after.nearMisses - before.nearMisses;
  const marginDelta =
    before.confidenceMargin === null || after.confidenceMargin === null
      ? null
      : after.confidenceMargin - before.confidenceMargin;

  let verdict: ScoreVerdict;
  if (failedDelta > 0 || healthDelta < -eps) verdict = "regressed";
  else if (failedDelta < 0 || healthDelta > eps) verdict = "improved";
  else verdict = "unchanged";

  return { verdict, healthDelta, failedDelta, nearMissDelta, marginDelta };
}

/** A compact, human/agent-readable line for a score. */
export function formatScore(s: EvalScore): string {
  const margin = s.confidenceMargin === null ? "n/a" : s.confidenceMargin.toFixed(3);
  return (
    `health ${s.health.toFixed(3)} — ${s.passed} passed, ${s.failed} failed, ` +
    `${s.nearMisses} near-miss(es); graded ${s.graded}, mean margin ${margin}`
  );
}
