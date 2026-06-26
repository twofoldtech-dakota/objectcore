---
id: f7-self-edit-boundary
type: decision
title: F7 self-improvement: forge may edit its generator, never its evaluator
tags: [f7, self-improvement, forge, gate, boundary]
source: plans/009-f7-recursive-self-improvement.md
created: 2026-06-26
---

Letting forge refine its own scaffolder (F7) is gated by separation of powers. The ONLY self-editable path is packages/forge/src/scaffold.ts (the generator); the eval gate, the derive/validate seam, the PluginSpec contract, and the meta-eval corpus are the trusted computing base and are off-limits. Enforcement is allowlist / default-deny (packages/forge/src/boundary.ts), so safety does NOT depend on the TCB list being exhaustive — anything not explicitly mutable is rejected. A self-edit is ADMITTED only if it clears the boundary + the golden corpus (byte-stable; human-only re-bless) + the guard corpus (every bad spec still rejects) + the full `bun run check`, via packages/forge/src/improve.ts and `bun run forge:improve`. The forge-improver subagent proposes Tier-A (behavior-preserving) refinements only and never self-merges; Tier B (new primitive/spec field) stays human-authored. Rationale: a self-improving system that can edit its own evaluator will Goodhart it, so the evaluator is the one fixed point the loop cannot touch. See [[factory-kb-and-loop]].
