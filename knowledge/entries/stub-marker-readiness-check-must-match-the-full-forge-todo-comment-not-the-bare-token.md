---
id: stub-marker-readiness-check-must-match-the-full-forge-todo-comment-not-the-bare-token
type: gotcha
title: Stub-marker readiness check must match the full <!-- forge:todo --> comment, not the bare token
tags: [evals, forge, readiness, gotcha]
source: packages/eval/src/coverage.ts (F4)
created: 2026-06-26
---

The body-filled readiness eval flags an unfilled scaffold by scanning a component body for the forge stub marker. Match the FULL HTML-comment literal `<!-- forge:todo -->`, never the bare substring `forge:todo`: a legitimately-filled body may *mention* the marker in prose (the self-reflection agent documents it as a failure mode it diagnoses), and a bare-substring match false-positives that as an unfilled stub. Caught live by F4's new agent-body-filled gate the moment it was added — the EDDOps loop working as intended.
