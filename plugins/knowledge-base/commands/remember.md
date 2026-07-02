---
description: Capture a durable engineering lesson into the ObjectCore knowledge base.
---
# /remember

Capture a durable, reusable lesson into ObjectCore's factory knowledge base
(`knowledge/`). Use this when something worth keeping emerges — a hard-won lesson,
a recurring pattern, a sharp gotcha, or a design decision.

Follow the **curating-knowledge** skill:
1. **Search first** for an existing entry: `bun run kb:search "<topic keywords>"`.
   If a near-duplicate exists, UPDATE or SUPERSEDE it
   (`bun run kb:curate --update <id>` / `--supersede <old-id>`) instead of adding a
   new one — `kb:add` now refuses a near-duplicate (naming the match; `--force`
   overrides). Otherwise pick the type (`lesson | pattern | gotcha | decision`) and
   a kebab-case id.
2. Append it: `bun run kb:add --json '{"type":"...","title":"...","tags":[...],"source":"...","body":"..."}'`
   (regenerates the index), or hand-author `knowledge/entries/<id>.md` then run
   `bun run kb:index`.
3. Verify with `bun run kb:check` (in sync, lifecycle-consistent, retrieval evals
   pass, within the 200-line/25KB budget).

Keep it to one tight fact with a real `source`. Never hand-edit `INDEX.md` — it is
generated.
