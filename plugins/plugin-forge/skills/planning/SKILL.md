---
name: planning
description: Turn a pinned plugin spec into a concrete PluginSpec the scaffolder can emit — choosing components, drafting each skill's trigger surface, and writing the activation eval cases. Use after specifying, when converting a spec into the JSON for bun run forge:scaffold.
---
# Planning

Convert the pinned spec into a `PluginSpec` the scaffolder consumes. This skill conforms to `writing-great-skills` — read it for the metadata / body / reference discipline.

**First, consult prior lessons.** Skim `knowledge/INDEX.md` (the factory KB) and open any entry whose title bears on this plugin's components, trigger surfaces, or eval cases — the loop writes lessons there precisely so the *next* generation doesn't repeat a past gate failure (the EDDOps feedback). Carry what's relevant into the decisions below.

Decide, in order:

1. **Components.** Map each outcome to the smallest component that enforces it. Prefer several small, composable skills over one monolith.
2. **Trigger surface (first-class output).** For each skill, draft `name` + `description` so it fires on the right task and stays quiet on near-misses. Most skill failures are description failures. Build the description from three parts: the **artifact** it acts on (e.g. "the staged diff"), the **form** of the output (e.g. "conventional-commits style"), and the **enumerated entry-triggers** (e.g. "about to commit / asks for a message / wants wording improved"). Then check it against the *sibling* surfaces already in the catalog so it doesn't overlap one of them.
3. **Layering.** Split each skill into metadata (always-on), body (loaded on match), and reference (pulled on demand). Pay token cost only for the layer reached.
4. **Catalog shape.** Version (start `0.0.1`), keywords, optional category, and a **string** `repository`. These become the catalog entry via `deriveCatalog`. `category` (optional) must come from the catalog's vocabulary — `workflow | governance | generator | meta | example` — or be omitted; do not invent a one-off string.
5. **Activation cases.** For each skill, write a **budget** of cases, not a token one: **≥2 positives** covering *distinct* intents (e.g. drafting vs. revising), **≥1 plain negative** (clearly unrelated), and **≥1 confusability negative** that shares vocabulary with a *sibling* catalog surface but has the wrong intent. These become `evals/activation.json` and are what gate the plugin. The gate now enforces both halves: a skill needs a positive case (or the scaffold refuses it) **and** the plugin needs a negative case (or coverage fails).
6. **Delegation cases (when the plugin ships `agents`).** An agent's `description` is a trigger surface too — it decides when the orchestrator *delegates* to the subagent — so it is gated exactly like a skill. Write a budget into `evals/delegation.json`: **≥1 positive** per agent (a task that should delegate to it) and **≥1 negative** (`expect: null` — ordinary work it must NOT hijack). The scaffolder refuses an agent with no positive delegation case; readiness fails a plugin with no negative one.
7. **MCP servers (when the plugin bundles tools, `mcp`).** Emitted as `.mcp.json` at the plugin root (server objects live there, never in `plugin.json` — its `mcpServers` is only a path-override string). A **stdio** server has `command` + `args`; reference in-plugin files with **`${CLAUDE_PLUGIN_ROOT}/...`** so they resolve wherever the plugin installs. A **remote** server has `type: "http"|"sse"` + `url`. **Bundling MCP is a credential surface**: an MCP server is arbitrary code the host runs with the user's credentials, so a plugin that ships one **cannot be published without attestation** (the release provenance gate scans for `.mcp.json`). Never inline secrets — pass them through `env`/`headers` referencing host variables.

## PluginSpec (what the scaffolder consumes)

```json
{
  "name": "kebab-name",
  "description": "one line — also the catalog entry's description",
  "version": "0.0.1",
  "keywords": ["objectcore"],
  "skills": [
    { "name": "do-x", "description": "Use when …", "body": "# Do X\n\nReal instructions: the steps, the output format, any reference to load." }
  ],
  "commands": [{ "name": "run-x", "description": "…" }],
  "agents": [{ "name": "do-x-deep", "description": "Use when … (delegated to, not auto-fired)", "body": "# Do X Deep\n\nThe subagent's system prompt." }],
  "mcp": { "x-tools": { "command": "bun", "args": ["${CLAUDE_PLUGIN_ROOT}/mcp/server.ts"] } },
  "activation": [
    { "prompt": "a prompt that should fire do-x", "expect": "do-x" },
    { "prompt": "a near-miss that should not fire anything", "expect": null }
  ],
  "delegation": [
    { "prompt": "a task that should delegate to do-x-deep", "expect": "do-x-deep" },
    { "prompt": "ordinary work it must not hijack", "expect": null }
  ]
}
```

A skill `body` is **required for real (non-meta) plugins** — omit it and the scaffolder emits a visible TODO stub comment that the eval gate rejects (`body-filled`). Write the actual instructions here.

Emit this JSON, then run `bun run forge:scaffold <spec.json>` followed by `bun run eval`.
