import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockDesignJudge, type DesignBrief, type DesignVerdict } from "../src/judge";
import { runDesignEval, summarizeSystem, loadDesignEvalSpec, type DesignEvalSpec } from "../src/evaluate";
import type { DesignSystemOutput } from "../src/derive";

const brief: DesignBrief = { name: "objectcore", adjectives: ["modern", "trustworthy"], intent: "a developer-tooling brand" };

const output: DesignSystemOutput = {
  issues: [],
  themes: [
    {
      name: "light",
      context: {},
      tokens: [
        { path: "color.bg", type: "color", value: "#ffffff" },
        { path: "space.md", type: "dimension", value: { value: 16, unit: "px" } },
      ],
    },
  ],
};

// ── MockDesignJudge ──
test("MockDesignJudge default heuristic scores higher when the summary reflects the brief", () => {
  const judge = new MockDesignJudge();
  return Promise.all([
    judge.assess("Does it read as modern and trustworthy?", brief, "modern trustworthy palette"),
    judge.assess("Does it read as modern and trustworthy?", brief, "beige floral ornate"),
  ]).then(([onBrief, offBrief]) => {
    expect(onBrief.score).toBeGreaterThan(offBrief.score);
  });
});

test("MockDesignJudge honors an injected verdict function", async () => {
  const fixed: DesignVerdict = { score: 0.9, passed: true, reason: "fixed" };
  const judge = new MockDesignJudge(() => fixed);
  expect(await judge.assess("anything", brief, "anything")).toEqual(fixed);
});

// ── runDesignEval ──
const judgeFor = (score: number) => new MockDesignJudge(() => ({ score, passed: score >= 0.5, reason: "stub" }));

test("a 'pass' case passes when the score clears the threshold", async () => {
  const spec: DesignEvalSpec = { brief, cases: [{ question: "modern?", expect: "pass", threshold: 0.6 }] };
  const [r] = await runDesignEval(spec, "summary", judgeFor(0.8));
  expect(r!.passed).toBe(true);
});

test("a 'pass' case fails when the score is below the threshold", async () => {
  const spec: DesignEvalSpec = { brief, cases: [{ question: "modern?", expect: "pass", threshold: 0.6 }] };
  const [r] = await runDesignEval(spec, "summary", judgeFor(0.3));
  expect(r!.passed).toBe(false);
});

test("a 'fail' case (the on-brand bracket) passes when the score stays LOW", async () => {
  // The system should NOT read as "playful" — a low score is the correct outcome.
  const spec: DesignEvalSpec = { brief, cases: [{ question: "playful?", expect: "fail", threshold: 0.6 }] };
  const [r] = await runDesignEval(spec, "summary", judgeFor(0.2));
  expect(r!.passed).toBe(true);
});

// ── loadDesignEvalSpec ──
test("loadDesignEvalSpec: missing file is null; malformed file fails loudly, named", async () => {
  const dir = await mkdtemp(join(tmpdir(), "design-eval-"));
  try {
    expect(await loadDesignEvalSpec(dir)).toBeNull(); // ENOENT only → "not specified"
    await mkdir(join(dir, "evals"), { recursive: true });
    await writeFile(join(dir, "evals", "design.json"), "{ bad json,");
    // A broken spec must never silently un-gate the judged layer.
    expect(loadDesignEvalSpec(dir)).rejects.toThrow(/design\.json/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── summarizeSystem ──
test("summarizeSystem renders themes and dotted token paths", () => {
  const text = summarizeSystem("objectcore", output);
  expect(text).toContain('Design system "objectcore"');
  expect(text).toContain("Theme light:");
  expect(text).toContain("color.bg (color) = #ffffff");
});
