---
id: subagent-tools-comma-serialization
type: gotcha
title: Serialize subagent tools as comma-separated strings, not YAML arrays
tags: [subagents, forge, gotcha]
source: https://github.com/anthropics/claude-code/issues/60237
created: 2026-06-26
---

In a plugin agent's frontmatter, `tools` / `disallowedTools` / `skills` accept
either a YAML array (`tools: [Read, Bash]`) or a comma-separated string
(`tools: Read, Bash`), but the ARRAY form has a known spawn-time bug that can
silently drop the first/last item. The forge engine (`scaffold.ts` `agentDoc`)
emits the comma-separated form. Agent frontmatter: name + description required;
optional model/effort/maxTurns/tools/disallowedTools/skills/memory/background/
isolation (only `worktree`). Plugin agents may NOT include hooks/mcpServers/
permissionMode (see subagent-forbidden-fields).
