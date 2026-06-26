---
id: plugin-hooks-json-wrapper
type: gotcha
title: A plugin's hooks.json wraps events in a top-level "hooks" key
tags: [hooks, forge, plugins]
source: https://code.claude.com/docs/en/plugins-reference
created: 2026-06-26
---

A plugin's `hooks/hooks.json` wraps the event map in a top-level `hooks` key:
`{ "hooks": { "SessionStart": [ { "matcher": "...", "hooks": [ <action> ] } ] } }`.
(settings.json hooks may use the direct event map without the wrapper.) The forge
engine owns this wrapper — `scaffold.ts` writes `{ hooks: spec.hooks }`, so a
PluginSpec carries just the events map. Action types: command | http | mcp_tool |
prompt | agent. Use `${CLAUDE_PLUGIN_ROOT}` for hook SCRIPT paths and
`${CLAUDE_PROJECT_DIR}` to reach the consuming project's files. Note plugin-shipped
subagents may NOT declare hooks (see subagent-forbidden-fields).
