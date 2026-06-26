# 008 — Research findings: foundational agentic pieces

Condensed from a deep-research run (2026-06-25): 3 angles → 16 sources fetched →
80 claims → 25 verified (3-vote adversarial), 22 confirmed / 3 refuted. This is
the evidence base for `plans/008-foundational-agentic-roadmap.md`. Full transcript
was a background workflow; key citations preserved below.

## PART A — Claude Code plugin primitives (high confidence, primary Anthropic docs)

Sources: `code.claude.com/docs/en/plugins-reference`,
`github.com/anthropics/claude-code/blob/main/plugins/README.md`,
`platform.claude.com/docs/en/agent-sdk/plugins`, `code.claude.com/docs/en/hooks`,
`code.claude.com/docs/en/memory`.

- **Layout** — a plugin is a self-contained dir; **only `plugin.json` lives in
  `.claude-plugin/`**, every component dir is at the plugin ROOT
  (`skills/`, `agents/`, `hooks/`, `.mcp.json`, `output-styles/`, …). This is
  exactly ObjectCore's existing components-at-root invariant. The forge engine
  must learn to emit `agents/` and `hooks/` (today only `commands/` + `skills/`).
  *Caveat (2-1):* these are DEFAULT auto-discovery locations, overridable in
  `plugin.json` — not immutable.
- **Hooks** — `hooks/hooks.json` (or inline in `plugin.json`). Five action types:
  `command | http | mcp_tool | prompt | agent`. ~32 lifecycle events incl.
  `SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`,
  `InstructionsLoaded`. **SessionStart ⇒ KB read**, **Stop ⇒ KB write trigger**,
  PreToolUse can block/replace tool input. Anthropic exemplars: `ralph-wiggum`
  (Stop hook continues iteration), `security-guidance` (PreToolUse), explanatory
  output style (SessionStart injects context).
- **Subagents** — `agents/*.md` with frontmatter: `name, description, model,
  effort, maxTurns, tools, disallowedTools, skills, memory, background,
  isolation`. Only valid `isolation` is `"worktree"`. **CRITICAL security gotcha:
  `hooks`, `mcpServers`, and `permissionMode` are NOT supported in plugin-shipped
  agents** — the forge subagent generator MUST omit these or it emits invalid/
  unsafe plugins.
- **MCP** — `.mcp.json` at plugin root using `${CLAUDE_PLUGIN_ROOT}`. Starts
  automatically when the plugin is enabled, but project-scope plugins' MCP servers
  go through per-server approval. **ObjectCore already has the matching governance**
  (`packages/release/src/provenance.ts` `MCP_CONFIG_FILES`, the publish-time
  attestation gate). Sequence this primitive LAST (credential surface).
- **Settings/"rules"** — NOT cleanly plugin-packagable: a plugin's `settings.json`
  supports only the `agent` and `subagentStatusLine` keys. So this "gap" is
  narrower than the others; likely a registry/`deriveCatalog` concern, not a
  plugin primitive. (Open question.)
- **Output styles** — `output-styles/`, low leverage, small effort.

## PART B — Self-improving system patterns

- **Reflexion** (Shinn et al., NeurIPS 2023; `arxiv.org/html/2303.11366`) — the
  canonical "write lessons back" loop. Three components: **Actor** (acts),
  **Evaluator** (scores), **Self-Reflection** (turns failure into verbal lessons).
  Dual memory: short-term trajectory + long-term reflection buffer (bounded ~1-3).
  No weight updates. Gains: HumanEval 80.1→91.0 pass@1, AlfWorld +22%, HotPotQA
  +20%. **Design constraint:** self-correction needs STRUCTURED guidance
  (schema-driven), not free-form prompting (Context Engineering survey
  `arxiv.org/pdf/2507.13334`).
- **EDDOps** (Xia et al., CSIRO Data61; `arxiv.org/abs/2411.13768`) — evaluation
  as a **continuous governing function**, not a terminal checkpoint; unifies
  offline (dev-time) + online (runtime) eval in a closed feedback loop. This is
  the pattern to turn ObjectCore's terminal eval gate into a self-improving loop.
- **Bounded KB** (`code.claude.com/docs/en/memory`) — index-plus-topic-files:
  first 200 lines / 25KB of an index file load at session start; topic files load
  on demand. The substrate pattern for our factory KB. (Solves bounded context +
  retrieval; **rot is handled separately** via aging/pruning, not by the split.)
- **Reference impl** (`github.com/UniM0cha/claude-self-improving-skills`, MEDIUM
  confidence — single third-party repo) — Stop hook distills work into user-dir
  `SKILL.md` after N tool calls/edits; usage-driven aging (stale 30d / archive 90d,
  thresholds doubled for `use_count ≥ 3`). The closest concrete blueprint for our
  KB-write loop; do NOT treat its thresholds as tuned for us.
- **Recursive self-improvement** (north star, research-grade) — "Self-Developing"
  (`arxiv.org/abs/2410.15639`), survey `arxiv.org/abs/2507.21046`. A model invents/
  refines its own improvement algorithms as eval-gated code. Aspirational only.

## REFUTED (do not rely on)
1. "Five distinct plugin mechanisms" framing — `commands/` is now legacy/folded
   into `skills/`, not a distinct primitive (0-3).
2. "Adopt Claude Code's built-in auto-memory as the factory KB" — it is
   interactive/session-facing, NOT a programmatic store the build/eval loop writes
   to. **We must build our own** (0-3).
3. Specific self-refine gain figures (~20% / 29.9-47.1%) — citation unsupported (0-3).

## OPEN QUESTIONS (carry into the build)
1. Can the build/eval loop write the KB in headless/CI? → drives "custom
   repo-tracked store" (the recommended path) vs. built-in. **Answer taken: custom.**
2. KB retrieval at derive/eval time — plain file reads vs SessionStart hook vs MCP
   resource? **Default taken: plain file reads**, revisit when the hooks primitive lands.
3. Settings/"rules" at the marketplace level — a `deriveCatalog`/registry concern?
4. A measurable KB-quality signal (does a stored lesson raise later eval pass
   rates?) so curation becomes eval-gated, not just time-based. **Measurement
   primitive BUILT** (`@objectcore/eval` `score.ts`: graded `EvalScore` +
   `compareScores`, emitted to `dist/eval-score.json`, enforced as the F7 admission
   pipeline's non-regression check; see `plans/009`). Remaining: the *longitudinal*
   half — persist score history so "does lesson X raise pass rates over time?" is
   answerable, not just single-step before/after.
5. Safe gating boundary for letting forge modify its own scaffolding code.
   **ANSWERED + built** (immutable-gate / separation-of-powers; `plans/009`,
   merged PR #14).
