---
id: components-at-root
type: pattern
title: Plugin components live at the root; only plugin.json in .claude-plugin/
tags: [plugins, layout, forge]
source: https://code.claude.com/docs/en/plugins-reference
created: 2026-06-26
---

In a Claude Code plugin, ONLY `plugin.json` lives in `.claude-plugin/`. Every
component directory — `skills/`, `agents/`, `hooks/`, `.mcp.json`,
`output-styles/` — sits at the plugin ROOT. These are default auto-discovery
locations (overridable in `plugin.json`), not immutable.

ObjectCore enforces this as hard invariant #3 (`validatePlacement` in
registry-core). When the forge engine learns a new primitive (hooks, subagents,
MCP), it emits the dir at the plugin root, never inside `.claude-plugin/`.
