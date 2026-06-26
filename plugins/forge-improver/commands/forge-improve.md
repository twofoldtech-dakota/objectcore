---
description: Propose and eval-gate a refinement to forge's own scaffolder code (F7 Phase 1). Delegates to the forge-improver subagent, then admits the change only if the eval-driven pipeline (boundary + golden + guard + full check) is green.
---
# /forge-improve

Run the F7 self-improvement loop on ObjectCore's **forge scaffolder**
(`packages/forge/src/scaffold.ts`). This is the human-initiated path (plan 009,
Phase 1): you ask for a refinement; the loop proposes it and **strictly eval-gates**
it before you review.

## How it works
1. Delegate to the **`forge-improver`** subagent with the refinement you want (it
   works in an isolated worktree and may edit only `scaffold.ts`).
2. The agent runs **`bun run forge:improve`**, the admission pipeline:
   - **boundary** — rejects fast if the diff touches the trusted computing base
     (the gate, seam, spec contract, or meta-eval corpus);
   - **meta-eval** — the golden corpus must stay byte-stable and the guard corpus
     must still reject (run inside `bun run check`);
   - **full gate** — `bun run check` must be green.
3. If **ADMITTED**, the agent hands you the diff for review. It never self-merges.

## When to use it
- Use it for **Tier A** refinements: a clearer generated stub body, tidier
  frontmatter serialization, a cleaner emit sequence — behavior-preserving or
  quality-only changes to how forge emits plugins.
- **Not** for fixing a specific plugin (that is the `self-reflection` subagent), and
  **not** for adding a new primitive or `PluginSpec` field (Tier B — human-authored;
  see `plans/009-f7-recursive-self-improvement.md`).
