---
name: curating-knowledge
description: Add or curate an entry in ObjectCore's factory knowledge base (a lesson, pattern, gotcha, or decision) stored under knowledge/. Use when a durable, reusable engineering lesson emerges, a design decision is made, or the knowledge base needs pruning.
---
# Curating Knowledge

ObjectCore's factory knowledge base is the growing memory the build + eval loop
reads on the way in and writes on the way out. It lives at `knowledge/`:
one frontmatter'd file per entry under `knowledge/entries/<id>.md`, plus a
generated `knowledge/INDEX.md`. The engine is `@objectcore/knowledge` (the
`KnowledgeStore` port + `FileKnowledgeStore`). Entries now have a **lifecycle**
(update / supersede / deprecate / verify), so the KB is no longer append-only:
fix, replace, or retire an entry instead of piling near-duplicates on top of it.

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
1. **Search first.** Before writing, look for an existing entry:
   ```bash
   bun run kb:search "<topic keywords>"
   ```
   (deterministic lexical retrieval over the corpus). If a near-duplicate exists,
   UPDATE or SUPERSEDE it (see the lifecycle below) instead of adding a new one —
   and note `kb:add` now **refuses** a near-duplicate, printing the match it hit;
   pass `--force` only when the overlap is genuinely coincidental.
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
   `bun run check`): it asserts `INDEX.md` byte-matches a fresh render, runs the
   offline retrieval evals, checks lifecycle integrity (supersede targets, cycles,
   links), and enforces the 200-line / 25KB budget.

## Curating existing entries (the lifecycle)
Entries are no longer append-only — fix, replace, retire, or re-confirm them with
`bun run kb:curate` (one mode per invocation; `--json` accepts inline or `@file`):
- **Update** a mistake or add detail:
  `bun run kb:curate --update <id> --json '<patch>'`.
- **Supersede** a lesson a newer one replaces:
  `bun run kb:curate --supersede <old-id> --json '<new entry>'`. The old entry
  drops out of `INDEX.md` (and reclaims budget) but stays on disk and in git
  history — **bounded forgetting**, not deletion.
- **Deprecate** a no-longer-true lesson:
  `bun run kb:curate --deprecate <id> --reason "<why>"`.
- **Verify** an entry you re-confirmed is still true:
  `bun run kb:curate --verify <id> [<id>...]` (stamps `verifiedAt`).

## Curation runbook (periodic)
- `bun run kb:stats` ranks **prune candidates** worst-first (stale, then
  never-cited, then oldest anchor) — the entry point for a curation pass.
- `bun run kb:verify` classifies each active entry fresh / stale / unverifiable
  from its `source` paths + git history. Both read git dates, so they are
  **local-only curation tooling** — deliberately NOT part of `bun run check`
  (CI clones are shallow, so git-dated staleness would be wrong in the gate).
- **Budget overflow is still the rot signal**, but now bounds **active** entries
  only — supersede/deprecate genuinely reclaims room, so keep curating (merge
  near-duplicates, tighten titles); the index split alone doesn't prevent rot.

## Citations + ROI
When a stored lesson actually helps (a fix, a diagnosis, a review):
- Record it: `bun run kb:cite <id> --source "<ref>"` — appends to
  `metrics/kb-usage.jsonl`, which feeds the never-cited signal in `kb:stats`.
- After a lesson-driven fix lands, link it to gate health:
  `bun run eval:record --note "lesson:<id>"` (surfaced back by `kb:stats`).

## Rules
- **Never hand-edit `knowledge/INDEX.md`** — it is a build artifact, like
  `marketplace.json`. Edit entries (or `kb:curate`), then `kb:index`.
- **One fact per entry**, kebab-case `id`, a real `source`.

## How this feeds the self-improving loop
This skill (and `/remember`) is the manual write path today. The same
`KnowledgeStore` is what the loop automates: `kb-writer`'s `SessionStart` hook
surfaces the INDEX and its `Stop` hook nudges capturing a durable lesson, and the
`self-reflection` subagent turns failing activation/output evals into entries here
— searching first, writing with `origin: reflection`, and superseding a wrong prior
lesson rather than duplicating it — closing the Reflexion loop on this substrate.
