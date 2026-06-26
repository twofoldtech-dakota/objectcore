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
baseline is main's CI score after PR #15. **Follow-up (ops):** have CI run
`bun run eval:record` on merges to `main` and commit the appended line back, so the trend
accrues automatically at every shipped checkpoint instead of by hand.
