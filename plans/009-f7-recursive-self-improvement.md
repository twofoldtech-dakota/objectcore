# Plan 009 (F7, design-only): the safe gating boundary for forge self-improvement

> **What this is**: the *design* deliverable for backlog item **F7** (the
> research-grade north star: forge proposing/refining its own scaffolding code,
> strictly eval-gated — "Self-Developing" style, `arxiv.org/abs/2410.15639`).
> Its job is to **answer the one open question that blocks F7** —
> `008-agentic-research-findings.md` open question 5: *"Safe gating boundary for
> letting forge modify its own scaffolding code."* It writes **no
> self-modifying code**; it specifies the boundary, the eval contract a self-edit
> must pass, and the staged build path that a *future, separately-approved*
> iteration would execute. F7 stays **DEFERRED** in the roadmap; this moves it
> from *deferred-and-undefined* to *deferred-but-designed*.
>
> **Drift check (run first)**: confirm the gate is green and the tree is clean
> (`bun run check`, `git status`). If `packages/forge/src/scaffold.ts`,
> `packages/eval/`, or `packages/registry-core/` have changed shape since this was
> written (commit `4bb402d`), re-read them before trusting the symbol references
> below.

## Status

- **Priority**: P1 (the project's stated north star) — but **design-only** this iteration.
- **Effort**: this plan = S (a written design). The build it unblocks = L, phased.
- **Risk**: the *design* is LOW (no code). The *system it describes* is the
  highest-blast-radius change the factory can make — letting an automated loop
  rewrite the engine that emits every plugin — which is exactly why it gets a
  boundary spec before a line of code.
- **Depends on**: F4 (the EDDOps evidence loop — the proposer's failure signal)
  and the whole eval gate. All merged.
- **Planned at**: commit `4bb402d`, 2026-06-26.
- **Outcome wanted**: a reviewed answer to open question 5, after which F7's
  *Phase 1* (below) becomes a normal checkpointed iteration.

## Why this needs a boundary before it needs code

Every other backlog item (F1–F6) was safe to build directly because the **gate
judged the output and a human merged it**. F7 is categorically different: the
thing being changed *is the generator the gate is supposed to police*. A
self-improving system that can reach its own evaluator will Goodhart it — the
cheapest way to make a red gate green is to weaken the gate. So the design
question is not "can forge write code" (it can draft anything) but **"what is the
optimizer mechanically forbidden from touching, and what must its output prove
before it is admitted."**

The good news: ObjectCore already encodes the answer's shape. The factory's whole
discipline is *the catalog is mutable, the gate is immutable* — no plugin enters
without passing `deriveCatalog` + `validateAll` + the eval gate, and the gate is
never hand-edited to pass. F7 simply **lifts that exact line one level up**: the
*scaffolder* becomes mutable-under-gate, while the *gate stays a fixed point the
optimizer cannot reach.*

## The design — four pillars

### Pillar 1 — Separation of powers (the immutable gate / trusted computing base)

Partition the repo into two zones with a **mechanically enforced** line between
them. The line is not a convention or a prompt instruction — it is a path
allowlist, checked by code that lives on the immutable side.

- **Mutable surface (the proposer MAY self-edit):** the *generative logic only* —
  the body emitters and emit sequence in `packages/forge/src/scaffold.ts`
  (`defaultSkillBody`, `defaultAgentBody`, `skillDoc`, `agentDoc`, `outputStyleDoc`,
  the `emit(...)` ordering). This is the code that turns an *already-validated*
  `PluginSpec` into bytes.
- **Trusted computing base (TCB — human-only, the optimizer is forbidden to touch):**
  - the gate: all of `packages/eval/` (output / coverage / readiness / activation /
    delegation / `evidence.ts`), `scripts/eval.ts`, `scripts/check-catalog.ts`;
  - the seam + floor: all of `packages/registry-core/` (`derive.ts`, `validate.ts`,
    `schema.ts`, `tags.ts`);
  - the spec contract: `packages/forge/src/types.ts` (`PluginSpec` and friends);
  - the **forge meta-eval corpus**: `packages/forge/test/**` and the golden
    fixtures Pillar 2 adds — the snapshots *are* the spec of correct behavior, so
    they must be unreachable from the loop, exactly like `marketplace.json` is a
    build artifact never hand-edited;
  - identity + CI: `objectcore.config.json`, `.github/workflows/**`, and the
    allowlist enforcer itself.

**The one-sentence answer to open question 5:** *forge may rewrite how it emits a
plugin, but it may never edit the code that decides whether that plugin is good.*
The allowlist check is the boundary; it lives in the TCB so a self-edit cannot
move its own fence.

### Pillar 2 — The eval contract (what a self-edit must prove)

A proposed diff to the mutable surface is admitted only if **all** hold. The new
machinery (golden corpus, guard corpus, purity check) lives in the TCB.

1. **Full gate green** — `bun run check` (tsc + `check:catalog` + `kb:check` +
   `test` + `eval`) passes, unchanged. This already proves the *live* catalog
   still derives byte-exact and every shipped surface still routes.
2. **Golden-corpus regression** — a frozen set of representative `PluginSpec`s
   (one per primitive: skill, command, hooks, agent, MCP, output-style, settings,
   and combinations) each snapshotted to its expected emitted file tree. A
   refinement that *claims* to be behavior-preserving must keep **every golden
   byte-identical**. Changing a golden output is a TCB edit — **human re-blessing
   only** — so the optimizer cannot silently rewrite the definition of "correct."
3. **Guard preservation** — the scaffolder's negative guards (`validateHooks`,
   `validateAgents` incl. `FORBIDDEN_AGENT_FIELDS`, `validateMcp`,
   `validateSettings`, the kebab + activation-required + delegation-required
   cross-checks) must still **throw on the existing bad-spec corpus**. The TCB owns
   that corpus; a self-edit passes only if every malformed spec still rejects. This
   closes guard erosion — the optimizer can't make the gate green by deleting a
   check, because the check's *absence* turns a required rejection into a pass and
   fails this suite.
4. **Capability comes with its own gate** — if a self-edit *adds* behavior, it must
   ship the golden + guard cases that gate it, mirroring how F2–F6 each landed with
   tests. The factory rule "no surface enters ungated" lifted to the engine: no
   generator capability enters without its own corpus.
5. **Determinism / purity preserved** — the scaffolder must stay pure-ish (no
   `Date.now`/`Math.random`, the discipline `derive.ts` and `evidence.ts` already
   follow). Property check: the same spec emits byte-identical trees across two
   runs.

### Pillar 3 — Two tiers of self-edit (the autonomy boundary)

Not all engine edits carry the same risk, so the optimizer's *autonomous reach* is
deliberately narrow and widens only as trust is earned.

- **Tier A — refinement (autonomous-eligible):** behavior-preserving or
  quality-only edits to the generative logic that keep every golden byte-identical,
  **or** change only a golden explicitly tagged `improvable` (e.g. the wording of a
  `defaultSkillBody` stub). Trigger: an EDDOps evidence signal (a near-miss / red
  gate from `dist/eval-evidence.json`) or an explicit refinement request. This is
  the genuinely recursive part — and it is bounded by an immutable corpus it cannot
  touch.
- **Tier B — capability expansion (human-initiated, optimizer-assisted):** a new
  primitive, a new `PluginSpec` field, a new component dir. This needs TCB changes
  (`types.ts`, `validatePlacement`, new goldens, new guards) which stay
  human-authored. The optimizer may *draft* the `scaffold.ts` portion, but the
  trusted surface and the new gate are written by a human — exactly the F2–F6
  workflow. **F7 automates Tier A and assists Tier B; it never automates the
  gate.** The north star (wider autonomy) is reached by *growing the meta-eval
  corpus until it can be trusted*, never by handing the optimizer the evaluator.

### Pillar 4 — The proposal mechanism (how a change moves, safely)

1. **Propose** — a `forge-improver` subagent (the Reflexion *Actor*; sibling to
   the existing `self-reflection` *generator*) reads the capability request or the
   EDDOps evidence and produces a diff **restricted to the mutable surface**.
2. **Isolate** — it runs with `isolation: "worktree"` (the only sanctioned
   isolation, per the subagent security note) so a bad edit never touches the live
   tree.
3. **Admit, mechanically** — an allowlist enforcer (TCB) rejects any diff that
   touches a TCB path *before* anything runs; then the worktree must pass the full
   Pillar-2 contract.
4. **Checkpoint** — a human-reviewed PR. Per hard rule #5's spirit (nothing enters
   the catalog ungated) and the roadmap's checkpointed-autonomy stance, an engine
   self-edit **never auto-merges**. The diff, the triggering evidence, the
   meta-eval result, and the proposing agent are recorded (a KB `decision` entry +
   the PR) so every self-edit is auditable.

## Failure modes — and where each is closed

| Failure | Closed by |
|---|---|
| **Gate subversion** (edit the evaluator to make red green) — the catastrophic case | Pillar 1 path allowlist (TCB-owned); the proposer cannot reach `packages/eval`, `registry-core`, or the corpora |
| **Goodhart the goldens** (silently rewrite the definition of correct) | Goldens are TCB; changing one requires human re-blessing (Pillar 2.2) |
| **Guard erosion** (delete a check to pass) | Guard-preservation suite: bad specs must still reject (Pillar 2.3) |
| **Silent capability** (new behavior, no test) | Capability-ships-its-own-gate rule (Pillar 2.4) |
| **Non-determinism creep** | Purity property check (Pillar 2.5) |
| **Blast radius of a bad edit** | Worktree isolation + human checkpoint + the existing CI gate (Pillar 4) |
| **Over-broad autonomy** | Tier A is behavior-preserving-only; Tier B stays human-authored (Pillar 3) |

## Staged build path (for a future, separately-approved iteration — NOT this plan)

1. **Phase 0 — the meta-eval corpus + the boundary enforcer (TCB; no optimizer
   yet). BUILT on `feat/f7-phase0`.** The golden-snapshot suite
   (`packages/forge/test/golden.test.ts` + `golden/*.json`) and the bad-spec guard
   corpus (`guard-corpus.test.ts`) run in `bun test` (= `bun run check`), and the
   path-allowlist enforcer is a pure module (`packages/forge/src/boundary.ts`,
   default-deny) plus a CLI (`scripts/check-self-edit-boundary.ts`). **Refinement
   to "wire into `bun run check`":** only the corpora and the enforcer's *unit
   tests* gate the general `check` — the enforcer **CLI** does NOT, because humans
   edit the TCB legitimately every day; it applies only to an *automated* self-edit
   proposal (the Phase-1 proposer flow). *This was the highest-value, lowest-risk
   first step and hardens the engine even if F7 never proceeds.*
2. **Phase 1 — Tier-A refinement, human-driven. BUILT on `feat/f7-phase0`.** The
   `forge-improver` subagent (`plugins/forge-improver/`, `isolation: worktree`,
   Tier-A discipline in its system prompt) proposes a behavior-preserving refinement
   to `scaffold.ts`; the eval-gated **admission pipeline** (`packages/forge/src/improve.ts`
   + `bun run forge:improve`) enforces the boundary, then runs the full gate, then
   reports ADMITTED/REJECTED. The agent surfaces an admitted diff for human review —
   it never self-merges (Pillar 4). A human asks for the refinement (no auto-trigger).
   *This is "forge proposes/refines its own scaffolding code, strictly eval-gated" —
   the meaningful core of F7, delivered safe and bounded.*
3. **Phase 2 — the trigger surface. PARTIALLY BUILT on `feat/f7-phase2`.** The
   **declared-improvability backlog** is built: the scaffolder marks a known-suboptimal
   default with a `forge:improvable — <reason>` comment (the scaffolder analogue of the
   `forge:todo` stub marker), and a pure scanner (`packages/forge/src/suggest.ts` +
   `bun run forge:suggest`) harvests them into a deterministic, gate-safe backlog the
   loop reads before delegating `forge-improver`. This turns Phase 1 (a human notices)
   into "the system surfaces its own candidates." The EDDOps evidence file stays the wrong
   trigger for a *generator* refinement — its failures/near-misses are about *plugin
   trigger surfaces* (`self-reflection`'s lesson domain), not `scaffold.ts` quality. A
   *declared* backlog is honest about being a seeded worklist; it does not pretend to be
   learned.
   - **OQ4 measurement primitive — BUILT on `feat/oq4-eval-score`.** The honest precondition
     for trusting *any* refinement (or lesson) is a *measurable* "did it help?", not just
     "did it still pass?". `packages/eval/src/score.ts` (`scoreReport` → a graded
     `EvalScore`: passed/failed/**nearMisses**/**confidenceMargin**/composite `health`;
     `compareScores` → `improved | unchanged | regressed`) turns the binary gate into a
     graded, comparable signal, written each run to `dist/eval-score.json`. The admission
     pipeline now enforces **non-regression**: `bun run forge:improve --baseline <score>`
     rejects a self-edit that lowers `health` (a new fragile green, thinner margin) even
     when the gate is still green — the 4th admission check. **Still deferred:** the
     *longitudinal* half of OQ4 (do captured lessons raise pass rates across *many* runs?)
     needs persisted score history (telemetry), and the autonomous executor (below).
4. **Phase 3 — autonomous execution + widening autonomy (RESEARCH; designed, not
   built; see the sketch below).** Widen the optimizer's reach only as the corpus and a
   real quality signal prove it can be trusted, and only for Tier A. **Tier B stays
   human-authored indefinitely.**

Phases 2 (the rest) and 3 each remain their own gated, checkpointed step; **none starts
without the maintainer re-approving.** Phase 0, Phase 1, and Phase 2's trigger surface
are built.

### The autonomous executor (designed, NOT built — the Phase 3 frontier)

A future `bun run forge:improve --auto` (or a workflow) would close the loop without a
human kicking it off:

1. read `bun run forge:suggest`'s backlog and pick a candidate;
2. spawn `forge-improver` in a **worktree** to implement *only* that candidate (the
   boundary already forbids it from leaving `scaffold.ts`);
3. run the admission pipeline (`bun run forge:improve`) — boundary → meta-eval → full gate;
4. on **ADMITTED**, open a PR for human review; on **REJECTED**, discard the worktree and
   record the verdict (and, if a golden flipped, surface it for re-blessing).

**Why it is deliberately not built here:**
- It requires a live model (an API key) and is non-deterministic, so — unlike the
  boundary, admission, and backlog bricks — it cannot be *gate-tested* the way the rest of
  F7 is. Shipping it green would mean shipping something the gate can't actually exercise.
- Pillar 4 already forbids self-merge: a human reviews **every** engine self-edit. So the
  autonomous executor's gain over human-initiated Phase 1 is *convenience, not capability* —
  it does not change what the system is allowed to do, only who presses start.
- The honest precondition is **open question 4**: until a signal shows that a given
  refinement actually *helps* (not merely *passes*), auto-proposing is churn. The
  *measurement primitive* is now built (the graded health score + non-regression admission),
  which gives the executor a verdict to act on; what is still missing is the *longitudinal*
  signal (does a captured lesson raise pass rates over time?) and the willingness to let it
  run unattended. The safe, testable bricks are built; turning on the thin, key-gated
  orchestration should wait for that longitudinal signal.

## This plan's deliverable & done criteria

ALL must hold for the *design* to be done:

- [ ] This file exists and answers open question 5 with a concrete, mechanically
      enforceable boundary (Pillar 1) and an eval contract (Pillar 2).
- [ ] The roadmap (`008-foundational-agentic-roadmap.md`) F7 row reads
      **DEFERRED → DESIGNED (see plan 009)**, not built.
- [ ] `plans/README.md` has a 009 row pointing here.
- [ ] No source under `packages/**` or `plugins/**` changed; `bun run check` still
      green and `git status` clean apart from these three docs.

## STOP / escalate conditions

- If review finds the immutable/mutable line can't be drawn cleanly through
  `packages/forge` (e.g. a refinement genuinely needs a `types.ts` change), that is
  evidence the Tier-A surface is narrower than hoped — **shrink the autonomous
  surface, never widen the TCB** to accommodate it.
- If anyone proposes letting the optimizer edit any TCB path "just for this case,"
  treat it as a STOP: it dissolves the only property that makes F7 safe.

## Maintenance notes

- The KB `decision` entry recording "F7 gating boundary = immutable-gate /
  separation-of-powers" is intentionally **deferred until this design is reviewed
  and blessed** — capturing an unreviewed decision as factory memory would be
  premature. Write it (via `bun run kb:add`) at merge, linking
  `[[factory-kb-and-loop]]`.
- Open questions 4 ("a measurable quality signal — do refinements/lessons raise later
  eval pass rates?") and 5 are siblings: a trustworthy Tier-A optimizer wants a signal
  that its refinements actually *help*, not merely *pass*. **OQ4's measurement primitive
  is now built** (`score.ts`: the graded `EvalScore` + `compareScores`, emitted to
  `dist/eval-score.json`, enforced as the admission pipeline's non-regression check). The
  remaining, *longitudinal* half — does a captured lesson raise pass rates across many
  runs? — needs persisted score history and is the next OQ4 increment.
- Keep this design and `scaffold.ts` in sync: if a future hand-authored primitive
  lands (Tier B), add its golden + guard cases to Phase 0's corpus in the same PR,
  so the meta-eval never lags the engine.
</content>
</invoke>
