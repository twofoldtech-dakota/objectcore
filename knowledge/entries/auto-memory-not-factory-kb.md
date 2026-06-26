---
id: auto-memory-not-factory-kb
type: decision
title: Build our own KB — Claude's built-in auto-memory can't be the factory KB
tags: [knowledge-base, memory, architecture]
source: plans/notes/008-agentic-research-findings.md
created: 2026-06-26
---

Claude Code's built-in auto-memory (`MEMORY.md`) is interactive / session-facing.
It is NOT a programmatic store the build + eval loop can read and write in
headless/CI runs (deep-research, refuted 0-3).

Decision: ObjectCore builds its own repo-tracked KB — `@objectcore/knowledge` (the
`KnowledgeStore` port + `FileKnowledgeStore`) over `knowledge/` — using the
index-plus-topic-files *pattern* from the memory docs, not the built-in feature.
The built-in auto-memory stays for cross-session assistant context; the factory KB
is the programmatic substrate for the self-improving loop.
