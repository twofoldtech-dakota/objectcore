---
id: judge-pool-distractor
type: gotcha
title: Adding a catalog surface can flip another plugin's borderline judge routing
tags: [evals, judge, delegation, activation, trigger-surface]
source: packages/eval/src/judge.ts
created: 2026-06-26
---

The activation/delegation judge (AnthropicJudge) runs at temperature 0 and routes each prompt against the WHOLE catalog's surface pool (all skills for activation, all agents for delegation). So adding a new plugin's skill/agent changes the candidate set for EVERY existing case and can flip a borderline-but-passing case belonging to an UNRELATED plugin: a new same-flavored surface acts as a distractor, and Haiku's 'when in doubt, fire nothing' bias returns null — the verdict's reason may even affirm the correct match while the label disagrees. Because temperature is 0 the result is deterministic, so re-running the gate does NOT fix it. Fix by DISJOINING the descriptions — make the new surface's trigger clearly distinct from the one it perturbed (and tighten the perturbed surface if needed) — never by weakening the eval case or re-running. Seen when forge-improver (F7, an 'improve the factory'-flavored agent) was added and flipped the reflection plugin's self-reflection delegation case-1 from self-reflection to none (PR #14); narrowing forge-improver's description to 'edits scaffolder source code, not diagnosing failures' restored it.
