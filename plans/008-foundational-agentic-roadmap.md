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
- **Progress**: F1 (KB) + F2 (hooks + `kb-writer`) + F3 (subagents + `reflection`)
  merged (11 plugins). **F4 (EDDOps eval-loop hardening) is built** on
  `feat/eddops-eval-loop` (gate green): the eval gate now (a) **closes the
  agent-delegation gap** — an agent's `description` is a trigger surface gated exactly
  like a skill's, via `evals/delegation.json` + coverage/readiness/judge (`delegation.ts`),
  forge refusing an agent with no delegation case; and (b) emits **structured EDDOps
  evidence** (`dist/eval-evidence.json`, `buildEvidence`) every run, which the
  `reflection` plugin's new `PostToolUse` hook reads to **auto-invoke `self-reflection`
  on a red gate**. The Reflexion/EDDOps loop is now closed: gate → evidence →
  generator → KB. Two lessons captured through the loop's own `kb:add` (the stub-marker
  gotcha + the trigger-surface-gating pattern). **F5 (MCP primitive) is built** on
  `feat/mcp-primitive`: the forge scaffolder now emits `.mcp.json` at the plugin root
  (`PluginSpec.mcp`, stdio/http/sse transports validated, `${CLAUDE_PLUGIN_ROOT}`
  convention), and the existing publish-time provenance gate (`hasMcpConfig` scans for
  `.mcp.json`) catches it for free — no new derivation path. A live MCP-bearing plugin
  is deliberately NOT added (credential surface); the KB-as-MCP-resource-server payload
  is a follow-on. **F6 (output-styles + minimal settings) is built** on
  `feat/output-styles`: the forge scaffolder now emits `output-styles/*.md` (hyphenated
  `keep-coding-instructions`/`force-for-plugin` frontmatter; ungated — not a trigger
  surface) and a narrow `settings.json` (only the packagable `agent`/`subagentStatusLine`
  keys; unknown keys rejected; `settings.agent` must name a declared agent). The
  components-at-root invariant (`validatePlacement`) now covers `output-styles/` too.
  **With F6 the forge-generatable Claude Code primitive set is complete** (skills,
  commands, hooks, agents, MCP, output styles, settings). Only F7 (stretch) remains.

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
| **F3** | **Subagents primitive + `self-reflection` subagent** | `scaffold.ts` now emits `agents/*.md` (AgentSpec; rejects `hooks`/`mcpServers`/`permissionMode`; tools serialized comma-separated; forge tests); a `reflection` plugin shipping the `self-reflection` subagent that diagnoses gate failures and writes durable lessons to the KB | **subagents** (forge-generatable) | Reflexion's Self-Reflection model (lesson generator) | M | F1 | **DONE (pending review)** — branch `feat/subagents-primitive`; agents-only plugin |
| **F4** | **EDDOps eval-loop hardening** | the eval gate emits structured evidence (`dist/eval-evidence.json` via `buildEvidence`: failures + near-misses) every run; the `reflection` `PostToolUse` hook reads it and auto-invokes `self-reflection` on a red gate; the planning skill consults the KB on the way in; **agent-delegation gap closed** (`delegation.ts` + `evals/delegation.json`, gated like skills, forge-enforced) | — (extends existing eval gate) + **agent delegation** (now gated) | turns the one-shot gate into a closed feedback loop | M | F1, F3 | **DONE (pending review)** — branch `feat/eddops-eval-loop`; gate green; 2 lessons captured through the loop |
| **F5** | **MCP primitive in forge** | scaffold `.mcp.json` at the plugin root (`PluginSpec.mcp`; stdio/http/sse validated; `${CLAUDE_PLUGIN_ROOT}` convention; engine owns the `{mcpServers:{…}}` wrapper). The existing publish-time provenance gate (`hasMcpConfig` → `.mcp.json`) catches it with no new path. Forge test asserts the emitted filename is in `MCP_CONFIG_FILES` | **MCP** (forge-generatable) | extends generatable set; enables tool-bearing plugins | M–L | F2 | **DONE (pending review)** — branch `feat/mcp-primitive`; gate green; no live MCP plugin shipped (credential surface) |
| **F6** | **Output-styles (+ minimal plugin settings) primitive** | forge emits `output-styles/<name>.md` (`OutputStyleSpec`; hyphenated frontmatter; ungated — not a trigger surface) + a narrow `settings.json` (`PluginSettingsSpec`: only `agent`/`subagentStatusLine`; unknown keys rejected; `agent` cross-checked vs declared agents). `validatePlacement` now also guards `output-styles/` | **output styles** | rounds out coverage; low leverage | S each | F1 | **DONE (pending review)** — branch `feat/output-styles`; gate green; forge primitive set now complete |
| **F7** | **STRETCH — recursive self-improvement of the forge engine** | forge proposes/refines its own scaffolding code, strictly eval-gated (Self-Developing style) | — | the north star; research-grade | L | F4 | **DESIGNED + Phase 0 + Phase 1 BUILT** on `feat/f7-phase0` (`plans/009`): (0) meta-eval golden + guard corpus + default-deny boundary enforcer; (1) the `forge-improver` subagent + the eval-gated admission pipeline (`improve.ts`, `bun run forge:improve`) — forge now proposes refinements to its own `scaffold.ts`, boundary+gate-admitted, human-merged (catalog → 12 plugins). **Phase 2 trigger surface BUILT** on `feat/f7-phase2` (the declared-improvability backlog: `forge:improvable` markers + `bun run forge:suggest`). Phase 2's learned signal (OQ4) + Phase 3's autonomous executor are designed-not-built (research frontier; Tier B stays human-authored). |

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
