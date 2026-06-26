---
name: curating-knowledge
description: Add or curate an entry in ObjectCore's factory knowledge base (a lesson, pattern, gotcha, or decision) stored under knowledge/. Use when a durable, reusable engineering lesson emerges, a design decision is made, or the knowledge base needs pruning.
---
# Curating Knowledge

ObjectCore's factory knowledge base is the growing memory the build + eval loop
reads on the way in and writes on the way out. It lives at `knowledge/`:
one frontmatter'd file per entry under `knowledge/entries/<id>.md`, plus a
generated `knowledge/INDEX.md`. The engine is `@objectcore/knowledge` (the
`KnowledgeStore` port + `FileKnowledgeStore`).

## When to write an entry
Capture something **durable and reusable** — a lesson that will still matter next
month and that isn't already obvious from the code or git history:
- **lesson** — something learned the hard way ("merging to main auto-publishes").
- **pattern** — a recurring design choice to repeat ("storage is a port").
- **gotcha** — a sharp edge that bites ("subagents can't declare hooks").
- **decision** — a chosen direction + why ("build our own KB, not auto-memory").

Do NOT store transient task state, secrets, or anything the repo already records
(code structure, past diffs, CLAUDE.md). If unsure, prefer one crisp entry over
several vague ones.

## Steps
1. **Pick the type** (`lesson | pattern | gotcha | decision`) and a kebab-case
   `id` (the filename stem). Check `knowledge/INDEX.md` first — if a near-duplicate
   exists, UPDATE that entry instead of adding a new one.
2. **Write the entry.** Either run the engine:
   ```bash
   bun run kb:add --json '{"type":"gotcha","title":"...","tags":["a","b"],"source":"<url|path>","body":"..."}'
   ```
   (or `--json @file.json`), which appends `knowledge/entries/<id>.md` and
   regenerates the index — or hand-author the file in the same frontmatter form
   (`id, type, title, tags, source?, created`) and then run `bun run kb:index`.
3. **Keep the body tight** — a few sentences: what the lesson is, why it matters,
   and how to apply it. Link the source (a doc URL, commit, file path, or plan).
4. **Regenerate + gate.** `bun run kb:index` then `bun run kb:check` (also part of
   `bun run check`): it asserts `INDEX.md` byte-matches a fresh render and stays
   within the 200-line / 25KB budget.

## Rules
- **Never hand-edit `knowledge/INDEX.md`** — it is a build artifact, like
  `marketplace.json`. Edit entries, then `kb:index`.
- **Budget overflow is the prune signal.** When `kb:check` fails on budget, curate:
  merge near-duplicates, delete stale entries, tighten titles. The bound is the
  KB's rot mechanism — the index split alone doesn't prevent rot.
- **One fact per entry**, kebab-case `id`, a real `source`.

## How this feeds the self-improving loop
This skill (and `/remember`) is the manual write path today. The same
`KnowledgeStore.append` is what the planned loop automates: F2's `kb-writer` hook
distills lessons on `Stop`/`PostToolUse`, and F3's `self-reflection` subagent turns
failing activation/output evals into entries here — closing the Reflexion loop on
top of this substrate.
