// The design-eval runner — the gate's judged layer, the analogue of @objectcore/eval's
// activation evals. A per-system `evals/design.json` (a brief + yes/no quality cases)
// is scored by a `DesignJudge` against a textual summary of the DERIVED system. A case
// passes when the judge's score crosses the case threshold AND that matches the case's
// `expect` (so a system can be required to PASS "reads as modern" and FAIL "reads as
// playful" — the on-brand bracket). When no API key is present the caller skips this
// layer (reported skipped, never silently passed), exactly like activation evals.

import { readFile } from "node:fs/promises";
import type { DesignSystemOutput } from "./derive";
import type { DesignBrief, DesignJudge } from "./judge";

/** One judged quality case. */
export interface DesignEvalCase {
  /** A yes/no quality question, e.g. "Does the palette read as modern and trustworthy?" */
  question: string;
  /** Whether the system is expected to PASS or FAIL this question (the on-brand bracket). */
  expect: "pass" | "fail";
  /** Min judge score (0..1) counted as a pass (default 0.6). */
  threshold?: number;
  note?: string;
}

/** Per-system spec, read from `<system>/evals/design.json`. */
export interface DesignEvalSpec {
  brief: DesignBrief;
  cases: DesignEvalCase[];
}

export interface DesignEvalResult {
  name: string;
  passed: boolean;
  level: "error" | "warning";
  detail: string;
  /** Judge score (0..1) — feeds a near-miss signal like the activation layer. */
  score: number;
}

const valStr = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));

/** Render a derived system to a compact, judge-readable text summary. Pure. */
export function summarizeSystem(name: string, output: DesignSystemOutput): string {
  const lines: string[] = [`Design system "${name}" — themes: ${output.themes.map((t) => t.name).join(", ") || "(none)"}.`];
  for (const theme of output.themes) {
    lines.push(`\nTheme ${theme.name}:`);
    for (const t of theme.tokens) lines.push(`  ${t.path} (${t.type}) = ${valStr(t.value)}`);
  }
  return lines.join("\n");
}

const snippet = (s: string): string => (s.length > 60 ? s.slice(0, 57) + "..." : s);

/** Score every case in a spec against a system summary using the judge. */
export async function runDesignEval(
  spec: DesignEvalSpec,
  summary: string,
  judge: DesignJudge,
): Promise<DesignEvalResult[]> {
  const results: DesignEvalResult[] = [];
  for (let i = 0; i < spec.cases.length; i++) {
    const c = spec.cases[i]!;
    const threshold = c.threshold ?? 0.6;
    const verdict = await judge.assess(c.question, spec.brief, summary);
    const judgedPass = verdict.score >= threshold;
    const expectedPass = c.expect === "pass";
    const passed = judgedPass === expectedPass;
    results.push({
      name: `case-${i}: ${snippet(c.question)}`,
      level: "error",
      passed,
      score: verdict.score,
      detail: passed
        ? `scored ${verdict.score.toFixed(2)} (${c.expect} as expected)`
        : `expected ${c.expect} (threshold ${threshold}), judge scored ${verdict.score.toFixed(2)} — ${verdict.reason}`,
    });
  }
  return results;
}

/** Load `<dir>/evals/design.json` if present. */
export async function loadDesignEvalSpec(dir: string): Promise<DesignEvalSpec | null> {
  try {
    const raw = await readFile(`${dir}/evals/design.json`, "utf8");
    return JSON.parse(raw) as DesignEvalSpec;
  } catch {
    return null;
  }
}
