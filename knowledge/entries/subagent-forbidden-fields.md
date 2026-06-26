---
id: subagent-forbidden-fields
type: gotcha
title: Plugin-shipped subagents may not declare hooks/mcpServers/permissionMode
tags: [subagents, forge, security]
source: https://code.claude.com/docs/en/plugins-reference
created: 2026-06-26
---

Plugin-shipped subagents (`agents/*.md`) support these frontmatter fields:
`name, description, model, effort, maxTurns, tools, disallowedTools, skills,
memory, background, isolation` (the only valid `isolation` value is `"worktree"`).

For security reasons, `hooks`, `mcpServers`, and `permissionMode` are NOT
supported in plugin-shipped agents. The F3 subagent generator in the forge engine
MUST omit those three fields or it will emit invalid/unsafe plugins. This is the
single most important constraint on the subagent-generation path.
