// Aggregate eval results into a report and render it. The gate is simple: any
// failed result at level "error" fails the run. Warnings are surfaced but never
// block — they are the "should fix" tier, not the "won't load / won't fire" tier.

import type { EvalReport, EvalResult } from "./types";

export function buildReport(results: EvalResult[], skipped: string[] = []): EvalReport {
  let passed = 0;
  let failed = 0;
  let warnings = 0;
  for (const r of results) {
    if (r.passed) passed++;
    else if (r.level === "warning") warnings++;
    else failed++;
  }
  return { results, skipped, passed, failed, warnings };
}

const icon = (r: EvalResult): string =>
  r.passed ? "✓" : r.level === "warning" ? "⚠" : "✗";

/** Human-readable report, grouped by suite. */
export function formatReport(report: EvalReport): string {
  const lines: string[] = [];
  const suites: Array<EvalResult["suite"]> = ["output", "coverage", "activation"];
  for (const suite of suites) {
    const group = report.results.filter((r) => r.suite === suite);
    if (group.length === 0) continue;
    lines.push(`\n${suite.toUpperCase()} EVALS`);
    for (const r of group) {
      const where = r.plugin ? `${r.plugin} ` : "";
      lines.push(`  ${icon(r)} ${where}${r.name} — ${r.detail}`);
    }
  }
  for (const s of report.skipped) lines.push(`\n[skipped] ${s}`);
  lines.push(
    `\n${report.passed} passed, ${report.failed} failed, ${report.warnings} warning(s).`,
  );
  return lines.join("\n");
}

/** The gate result: true when nothing failed at error level. */
export function isGreen(report: EvalReport): boolean {
  return report.failed === 0;
}
