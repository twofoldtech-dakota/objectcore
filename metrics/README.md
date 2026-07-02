# metrics/

Longitudinal gate-health history — the persisted half of research **open question 4**
(*does the factory get healthier as lessons/refinements accumulate?*).

## `eval-history.jsonl`

An append-only, git-**tracked** log: one JSON object per line, each a recorded gate run.
Unlike `dist/eval-score.json` (a per-run build artifact, gitignored), this survives across
runs so trends are visible. Each entry is a `ScoreHistoryEntry`:

```json
{"recordedAt":"<ISO>","commit":"<short sha>","note":"...","score":{ EvalScore }}
```

- **`bun run eval:record [--note "..."]`** — append the latest `dist/eval-score.json`
  (run `bun run eval` / `bun run check` first). Stamps the timestamp and HEAD sha.
- **`bun run eval:trend`** — print the overall and last-step health trend (read-only).

The pure parse/serialize/summarize logic is `@objectcore/eval` `history.ts`; trends reuse
`compareScores`, so this layer stays consistent with the single-run score.

## Note on population

The confidence-bearing fields (`graded`, `confidenceMargin`, `nearMisses`) only populate
when the judge ran (an API key is present) — i.e. **in CI**, not local dev. The seeded
baseline is main's CI score after PR #15.

## Auto-recording in CI (inert until armed)

`.github/workflows/record-history.yml` runs on merge to `main`, records the score
(`eval:record --if-changed`, so it logs inflection points, not an entry per merge), and
commits the appended line back. It is **inert until armed** — like `deploy.yml` — because
"CI writes back to the repo" is a deliberate opt-in.

**To arm it:** set the repo variable `OBJECTCORE_RECORD_HISTORY=true` (Settings → Secrets
and variables → Actions → **Variables**). Until then the job is a harmless skip. Note: if
`main` is a protected branch, allow the Actions bot to push (or the auto-commit will fail);
the commit uses `[skip ci]` and the trigger ignores `metrics/**`, so it can't loop.

## `kb-usage.jsonl`

The knowledge base's usage / ROI signal — an append-only, git-**tracked** citation log,
the same mechanics as `eval-history.jsonl` (union-merge-friendly, durable, timestamped;
chosen over frontmatter counters, which churn entry files per citation, breed merge
conflicts, and carry no timestamps). One JSON object per line, each a recorded citation
(a `UsageEvent`, stable key order `citedAt, id, source?`):

```json
{"citedAt":"<ISO instant>","id":"<entry-id>","source":"<optional ref>"}
```

- **`bun run kb:cite <id> [--source "<ref>"]`** — validate the id resolves (citing a
  ghost is a bug), then append one line (stamping `citedAt`). The file is born on first
  cite; it is never committed empty.
- **`bun run kb:stats [--json] [--fast]`** — join every entry × its citations × its WP2
  staleness and rank ACTIVE prune candidates worst-first (stale → never-cited → oldest
  anchor). `--fast` skips the git subprocesses (the freshness column then shows `-`).

The pure parse/serialize/aggregate logic is `@objectcore/knowledge` `usage.ts`; the file
is written ONLY by `kb:cite` and read ONLY by `kb:stats`. The eval linkage is prose-level:
after a lesson-driven fix lands, `bun run eval:record --note "lesson:<id>"`, and `kb:stats`
surfaces those refs by reading `eval-history.jsonl` as a plain file — it never touches
`@objectcore/eval`.
