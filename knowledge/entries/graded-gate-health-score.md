---
id: graded-gate-health-score
type: pattern
title: Grade the gate (a health score) to measure whether an intervention actually helped
tags: [evals, eddops, self-improvement, forge, score]
source: packages/eval/src/score.ts
created: 2026-06-26
---

A binary gate (green/red) can't tell whether a change made things BETTER or merely still-passing — the signal a self-improving loop needs. scoreReport (packages/eval/src/score.ts) distills an EvalReport into a graded EvalScore: passed/failed, nearMisses (fragile greens, confidence <= the 0.6 near-miss threshold), confidenceMargin (mean headroom above the firing line over graded passes), and a 0..1 composite 'health' (full passes count, fragile greens cost half, failures pull it down). It is written each run to dist/eval-score.json (build artifact). compareScores(before, after) returns improved | unchanged | regressed — any NEW failure or lower health is a regression. This answers open question 4's single-step half: 'did this refinement/lesson help?' is now measurable, not just 'did it still pass?'. The F7 admission pipeline enforces it as a 4th check: `bun run forge:improve --baseline <pre-edit score.json>` rejects a self-edit that lowers health even when the gate is still green. Caveat: the confidence-bearing half (activation/delegation margins, near-misses) only exists when the judge ran (an API key is present); offline the score reflects only the deterministic layers. The LONGITUDINAL half of OQ4 — do captured lessons raise pass rates across many runs? — still needs persisted score history. See [[judge-pool-distractor]] (near-misses are the same EDDOps signal).
