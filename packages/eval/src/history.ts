// OQ4 longitudinal — persist gate-health scores over time so "is the factory getting
// healthier as lessons/refinements accumulate?" becomes answerable, not just the
// single-step before/after that score.ts already gives. The history is an append-only,
// git-TRACKED JSONL log (unlike dist/eval-score.json, a per-run build artifact): one
// EvalScore + provenance per line, diffable in PRs. Pure parse/serialize/summarize live
// here; scripts/eval-record.ts appends (stamping time + commit), scripts/eval-trend.ts
// reports. Trends reuse compareScores, so the score and history layers stay consistent.

import { compareScores, type EvalScore, type ScoreDelta } from "./score";

/** One recorded gate run: the score plus injected provenance. */
export interface ScoreHistoryEntry {
  /** ISO timestamp, injected by the recorder (kept out of the pure layer). */
  recordedAt: string;
  /** Short git sha of the recorded commit, injected. */
  commit?: string;
  note?: string;
  score: EvalScore;
}

/** Serialize one entry to a single JSONL line (no trailing newline). */
export function serializeEntry(entry: ScoreHistoryEntry): string {
  return JSON.stringify(entry);
}

/** Parse a JSONL history blob. Blank lines are skipped; a malformed line throws with its
 *  line number rather than silently dropping data. */
export function parseHistory(jsonl: string): ScoreHistoryEntry[] {
  const out: ScoreHistoryEntry[] = [];
  const lines = jsonl.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as ScoreHistoryEntry);
    } catch {
      throw new Error(`eval-history.jsonl: malformed JSON on line ${i + 1}`);
    }
  }
  return out;
}

export interface HistorySummary {
  count: number;
  first: ScoreHistoryEntry | null;
  latest: ScoreHistoryEntry | null;
  /** first.score → latest.score over the whole window; null with < 2 entries. */
  overall: ScoreDelta | null;
  /** previous.score → latest.score (the most recent step); null with < 2 entries. */
  lastStep: ScoreDelta | null;
}

/** Summarize a history into an overall and a last-step trend (pure). */
export function summarizeHistory(entries: ScoreHistoryEntry[]): HistorySummary {
  const count = entries.length;
  const first = count ? entries[0]! : null;
  const latest = count ? entries[count - 1]! : null;
  const overall = count >= 2 ? compareScores(first!.score, latest!.score) : null;
  const lastStep = count >= 2 ? compareScores(entries[count - 2]!.score, latest!.score) : null;
  return { count, first, latest, overall, lastStep };
}

/** A compact, human/agent-readable digest of the trend. */
export function formatHistorySummary(s: HistorySummary): string {
  if (s.count === 0) {
    return "eval-history: no entries yet — run `bun run eval:record` after a gate run.";
  }
  if (s.count === 1) {
    return (
      `eval-history: 1 entry (baseline ${s.latest!.recordedAt}) — ` +
      `health ${s.latest!.score.health.toFixed(3)}; no trend yet.`
    );
  }
  return [
    `eval-history: ${s.count} entries`,
    `  first  ${s.first!.recordedAt} — health ${s.first!.score.health.toFixed(3)}`,
    `  latest ${s.latest!.recordedAt} — health ${s.latest!.score.health.toFixed(3)}`,
    `  overall:   ${s.overall!.verdict} (Δhealth ${s.overall!.healthDelta.toFixed(3)}, Δnear-miss ${s.overall!.nearMissDelta})`,
    `  last step: ${s.lastStep!.verdict} (Δhealth ${s.lastStep!.healthDelta.toFixed(3)})`,
  ].join("\n");
}
