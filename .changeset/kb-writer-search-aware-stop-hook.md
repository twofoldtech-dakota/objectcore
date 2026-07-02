---
"kb-writer": patch
---

Stop-hook prompt is now search-aware — check `bun run kb:search` for an existing entry before capturing, with explicit silent-stop guidance when nothing durable emerged or the lesson is already captured. The load-kb `SessionStart` hint also mentions `bun run kb:search` for on-demand retrieval.
