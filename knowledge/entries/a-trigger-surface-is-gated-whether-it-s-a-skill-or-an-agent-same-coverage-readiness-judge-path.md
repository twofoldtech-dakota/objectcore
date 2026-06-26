---
id: a-trigger-surface-is-gated-whether-it-s-a-skill-or-an-agent-same-coverage-readiness-judge-path
type: pattern
title: A trigger surface is gated whether it's a skill or an agent — same coverage/readiness/judge path
tags: [evals, agents, delegation, gate, eddops]
source: plans/008 F4; packages/eval/src/{coverage,delegation}.ts, packages/forge/src/scaffold.ts
created: 2026-06-26
---

An agent's `description` decides when the orchestrator delegates to it — the same kind of trigger surface a skill's description is for activation — so it must be gated the same way, never enter the catalog ungated. The shape mirrors skill activation exactly: a per-plugin `evals/delegation.json` (positive + negative cases), a deterministic coverage check (every agent needs a positive case), a readiness check (a negative case + no `<!-- forge:todo -->` stub body), and the SAME `Judge` routing a prompt against the agent-surface pool (delegation evals run only with an API key, like activation). forge refuses an agent with no positive delegation case, just as it refuses a skill with no activation case. Apply this to any future component that carries a description a router/orchestrator reads (the rule generalizes beyond skills and agents).
