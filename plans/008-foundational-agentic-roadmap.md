# Plan 008 (epic): Foundational agentic pieces — the build-loop backlog

> **What this is**: not a single executable plan but the **prioritized worklist**
> for a checkpointed build loop. Each F-item below becomes its own focused plan
> (or a direct forge run) when the loop reaches it. Evidence base:
> `plans/notes/008-agentic-research-findings.md` (deep-research, 2026-06-25).
>
> **Drift check (run first, each iteration)**: `bun run check` must be green and
> `git status` clean before starting an item; re-read this file and the item's
> entry in case priorities shifted.

## Status

- **Priority**: P1 (this is the project's next major thrust)
- **Planned at**: commit `9bd93d3`, 2026-06-25
- **Theme**: close the Claude Code **primitive gaps** (so the forge engine can
  *generate* them) AND stand up the **self-improving loop** (KB + eval feedback).
- **Loop autonomy**: **checkpointed** — one item per iteration, gated, then pause
  for review/merge before the next (maintainer's choice).
- **Progress**: F1 (KB) merged (9 plugins). F2 (hooks primitive + `kb-writer`)
  **built** on `feat/hooks-primitive` (gate green, 10 plugins; forge now emits
  hooks; loop write path dogfooded via `kb:add`). **F3 (subagents primitive +
  `self-reflection` subagent) is next** — the lesson *generator* that turns eval
  failures into KB entries.

## The self-improving loop these items assemble

Items F1–F4 are not independent — they snap together into one Reflexion/EDDOps loop:

```
        ┌──────────────── F1: Knowledge Base (substrate) ───────────────┐
        │  bounded index + on-demand topic files, repo-tracked,         │
        │  programmatically read/written by forge + eval                │
        └───────▲───────────────────────────────────────────▲──────────┘
   reads on     │ (SessionStart hook / file reads)           │ writes lessons
   next build   │                                            │ (Stop/PostToolUse hook)
        ┌───────┴────────┐   eval failure   ┌────────────────┴──────────┐
        │ F3 self-       │◀─────────────────│ F2 hooks primitive +      │
        │ reflection     │   structured     │ kb-writer plugin          │
        │ subagent       │   lesson         └───────────────────────────┘
        └───────▲────────┘
                │ continuous eval evidence (not a terminal gate)
        ┌───────┴────────────────────────────────────────────┐
        │ F4: EDDOps eval-loop hardening                       │
        └─────────────────────────────────────────────────────┘
```

## Backlog (ordered for the loop; effort S < M < L)

| ID | Item | Builds | Closes primitive gap | Self-improving role | Effort | Depends | Status |
|----|------|--------|----------------------|---------------------|--------|---------|--------|
| **F1** | **Knowledge base substrate** (FIRST) | `@objectcore/knowledge` (`KnowledgeStore` port + `FileKnowledgeStore`) over `knowledge/` (entries + generated `INDEX.md`); `kb:add`/`kb:index`/`kb:check` CLIs (`kb:check` in the gate); a `knowledge-base` governance meta-plugin (`/remember` + `curating-knowledge`) | — (substrate, not a CC primitive) | the store every other loop piece reads/writes | M | — | **DONE (pending review)** — branch `feat/knowledge-base`; storage is a port so DB (Turso) + MCP-resource are later adapters/seams |
| **F2** | **Hooks primitive + `kb-writer` plugin** | `scaffold.ts` now emits `hooks/hooks.json` (PluginSpec.hooks; engine owns the `{hooks:{...}}` wrapper; validates events/action-types; forge tests); a hooks-only `kb-writer` plugin: `SessionStart` command surfaces `knowledge/INDEX.md` into context, `Stop` prompt nudges lesson capture | **hooks** (forge-generatable) | the read/write surface around the KB (Reflexion long-term memory) | M–L | F1 | **DONE (pending review)** — branch `feat/hooks-primitive`; kb-writer is hooks-only to avoid an activation clash with `curating-knowledge` |
| **F3** | **Subagents primitive + `self-reflection` subagent** | teach `scaffold.ts` to emit `agents/*.md` (OMIT `hooks`/`mcpServers`/`permissionMode`); a subagent that converts failing activation/output evals into structured KB entries | **subagents** (forge-generatable) | Reflexion's Self-Reflection model (lesson generator) | M | F1 | TODO |
| **F4** | **EDDOps eval-loop hardening** | promote the terminal eval gate to a continuous governing function: capture structured eval evidence (pass/fail, near-misses) → write to F1 → forge consumes prior lessons on next generation | — (extends existing eval gate) | turns the one-shot gate into a feedback loop | M | F1, F3 | TODO |
| **F5** | **MCP primitive in forge** | scaffold `.mcp.json` with `${CLAUDE_PLUGIN_ROOT}`, behind the existing publish-time provenance/attestation gate | **MCP** (forge-generatable) | extends generatable set; enables tool-bearing plugins | M–L | F2 | TODO |
| **F6** | **Output-styles (+ minimal plugin settings) primitive** | scaffold `output-styles/`; whatever of `settings.json` (`agent`/`subagentStatusLine`) is packagable | **output styles** | rounds out coverage; low leverage | S each | F1 | TODO |
| **F7** | **STRETCH — recursive self-improvement of the forge engine** | forge proposes/refines its own scaffolding code, strictly eval-gated (Self-Developing style) | — | the north star; research-grade | L | F4 | DEFERRED |

## Corrections baked into the ordering (from the research)
- **Built-in auto-memory ≠ factory KB** (refuted). F1 builds a custom repo-tracked
  store; it does not reuse Claude's session auto-memory.
- **Settings/"rules" is a weak plugin primitive** (only `agent`/`subagentStatusLine`).
  It is NOT its own backlog item; folded as a minor part of F6 and flagged as a
  possible `deriveCatalog`/registry concern instead (open question 3).
- **Subagent security gotcha** — F3 must omit `hooks`/`mcpServers`/`permissionMode`.
- **Structured, not free-form reflection** — F3's lesson output is schema-driven.

## The build-loop procedure (checkpointed)

Each iteration:
1. **Pick** the lowest-ID `TODO` whose deps are `DONE`.
2. **Plan** — if non-trivial, write `plans/00N-<slug>.md` (forge handles per-plugin specs).
3. **Build** — keep new work behind existing ports (`scaffold.ts`, `deriveCatalog`,
   the eval gate); never add a second derivation path (CLAUDE.md invariant #2).
4. **Gate** — `bun run check` green (incl. activation eval where a key is needed in CI).
5. **Checkpoint** — commit on a branch, open a PR, **pause for review/merge**.
6. **Record** — update this table's Status; write any lesson into the KB (once F1 exists).
7. Next iteration.

> Autonomy note: this is deliberately NOT an unattended `/loop` cron — each item
> enters the catalog only after review (hard rule #5 in spirit). If the maintainer
> later wants hands-off runs, the same procedure can be wrapped in `/loop`.
