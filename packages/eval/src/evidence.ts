// EDDOps: evaluation as a continuous governing function, not a terminal checkpoint.
// `buildEvidence` distills an EvalReport into a structured, machine-readable artifact
// so a failure can FEED the loop — the reflection plugin's hook reads it and the
// self-reflection subagent diagnoses from it — instead of only blocking. Pure: the
// timestamp is injected (`now`) so the builder stays deterministic and testable, the
// same discipline the workflow engine and derive.ts follow.

import type {
  EvalEvidence,
  EvalReport,
  EvidenceFailure,
  EvidenceNearMiss,
} from "./types";

/** A passed route at or below this confidence is a "fragile green" — green today,
 *  the first case to flip when a sibling description changes. Surfaced as a near-miss
 *  (evidence only; never fails the gate — no silent caps the other way either). */
export const NEAR_MISS_THRESHOLD = 0.6;

export interface BuildEvidenceOpts {
  /** ISO timestamp of the run; injected by the caller (scripts/eval.ts). */
  now: string;
  /** Override the near-miss confidence threshold. */
  nearMissThreshold?: number;
}

/** Distill a report into evidence: every error-level failure, plus passed
 *  activation/delegation routes whose confidence fell below the threshold. */
export function buildEvidence(report: EvalReport, opts: BuildEvidenceOpts): EvalEvidence {
  const threshold = opts.nearMissThreshold ?? NEAR_MISS_THRESHOLD;

  const failures: EvidenceFailure[] = report.results
    .filter((r) => !r.passed && r.level === "error")
    .map((r) => ({ suite: r.suite, plugin: r.plugin, name: r.name, detail: r.detail }));

  const nearMisses: EvidenceNearMiss[] = report.results
    .filter(
      (r) =>
        r.passed &&
        typeof r.confidence === "number" &&
        r.confidence <= threshold,
    )
    .map((r) => ({
      suite: r.suite,
      plugin: r.plugin,
      name: r.name,
      detail: r.detail,
      confidence: r.confidence as number,
    }));

  return {
    generatedAt: opts.now,
    green: report.failed === 0,
    passed: report.passed,
    failed: report.failed,
    warnings: report.warnings,
    failures,
    nearMisses,
    skipped: report.skipped,
  };
}

/** A compact, human-readable digest of evidence — what the reflection hook surfaces
 *  into context and what scripts/eval.ts prints on a red gate. */
export function summarizeEvidence(evidence: EvalEvidence): string {
  const lines: string[] = [];
  lines.push(
    evidence.green
      ? `gate GREEN — ${evidence.passed} passed`
      : `gate RED — ${evidence.failed} failed, ${evidence.passed} passed`,
  );
  for (const f of evidence.failures) {
    lines.push(`  ✗ [${f.suite}] ${f.plugin ? f.plugin + " " : ""}${f.name} — ${f.detail}`);
  }
  if (evidence.nearMisses.length) {
    lines.push(`  near-misses (passed but fragile, ≤ confidence threshold):`);
    for (const n of evidence.nearMisses) {
      lines.push(
        `  ~ [${n.suite}] ${n.plugin ? n.plugin + " " : ""}${n.name} (conf ${n.confidence.toFixed(2)})`,
      );
    }
  }
  return lines.join("\n");
}
