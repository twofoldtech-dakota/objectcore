import { test, expect } from "bun:test";
import { scoreReport, compareScores, formatScore } from "../src/score";
import type { EvalReport, EvalResult } from "../src/types";

function report(results: EvalResult[], skipped: string[] = []): EvalReport {
  return {
    results,
    skipped,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed && r.level === "error").length,
    warnings: results.filter((r) => !r.passed && r.level === "warning").length,
  };
}

const ok = (name: string): EvalResult => ({ suite: "coverage", name, passed: true, level: "error", detail: "" });
const fail = (name: string): EvalResult => ({ suite: "coverage", name, passed: false, level: "error", detail: "" });
const routed = (name: string, confidence: number): EvalResult => ({
  suite: "activation", name, passed: true, level: "error", detail: "", confidence,
});

test("deterministic-only report: full health, nothing graded", () => {
  const s = scoreReport(report([ok("a"), ok("b"), ok("c")]));
  expect(s).toMatchObject({ passed: 3, failed: 0, nearMisses: 0, graded: 0, confidenceMargin: null });
  expect(s.health).toBe(1);
});

test("graded passes: near-misses counted, confidence margin is mean headroom above threshold", () => {
  // threshold 0.6: 0.9 is solid (margin +0.3), 0.55 is a near-miss (margin -0.05).
  const s = scoreReport(report([ok("a"), routed("hi", 0.9), routed("lo", 0.55)]));
  expect(s.graded).toBe(2);
  expect(s.nearMisses).toBe(1);
  expect(s.confidenceMargin).toBeCloseTo((0.3 + -0.05) / 2, 6);
  // passed=3, nearMisses=1 -> (3 - 0.5)/3
  expect(s.health).toBeCloseTo((3 - 0.5) / 3, 6);
});

test("a failure pulls health below 1 and is counted", () => {
  const s = scoreReport(report([ok("a"), ok("b"), fail("c")]));
  expect(s.failed).toBe(1);
  expect(s.health).toBeCloseTo(2 / 3, 6);
});

test("compareScores: removing a failure is an improvement", () => {
  const before = scoreReport(report([ok("a"), fail("b")]));
  const after = scoreReport(report([ok("a"), ok("b")]));
  expect(compareScores(before, after).verdict).toBe("improved");
});

test("compareScores: a new failure is a regression outright", () => {
  const before = scoreReport(report([ok("a"), ok("b")]));
  const after = scoreReport(report([ok("a"), fail("b")]));
  const d = compareScores(before, after);
  expect(d.verdict).toBe("regressed");
  expect(d.failedDelta).toBe(1);
});

test("compareScores: more fragile greens lowers health -> regression even while green", () => {
  const before = scoreReport(report([routed("x", 0.9), routed("y", 0.9)]));
  const after = scoreReport(report([routed("x", 0.9), routed("y", 0.55)])); // y became fragile
  const d = compareScores(before, after);
  expect(d.nearMissDelta).toBe(1);
  expect(d.verdict).toBe("regressed");
});

test("compareScores: identical scores are unchanged", () => {
  const a = scoreReport(report([ok("a"), routed("x", 0.8)]));
  const b = scoreReport(report([ok("a"), routed("x", 0.8)]));
  expect(compareScores(a, b).verdict).toBe("unchanged");
  expect(formatScore(a)).toMatch(/health 1\.000/);
});
