import { test, expect } from "bun:test";
import {
  parseHistory,
  serializeEntry,
  summarizeHistory,
  formatHistorySummary,
  type ScoreHistoryEntry,
} from "../src/history";
import type { EvalScore } from "../src/score";

const score = (health: number, failed = 0, nearMisses = 0): EvalScore => ({
  passed: 10,
  failed,
  warnings: 0,
  nearMisses,
  graded: 5,
  confidenceMargin: 0.3,
  health,
});

const entry = (recordedAt: string, s: EvalScore): ScoreHistoryEntry => ({
  recordedAt,
  commit: "abc1234",
  score: s,
});

test("serialize -> parse round-trips an entry", () => {
  const e = entry("2026-06-26T00:00:00.000Z", score(1));
  expect(parseHistory(serializeEntry(e) + "\n")).toEqual([e]);
});

test("parseHistory skips blank lines and throws on a malformed line", () => {
  const jsonl = `${serializeEntry(entry("a", score(1)))}\n\n  \n`;
  expect(parseHistory(jsonl)).toHaveLength(1);
  expect(() => parseHistory("{not json}\n")).toThrow(/malformed JSON on line 1/);
});

test("summarizeHistory: 0 and 1 entries have no trend", () => {
  expect(summarizeHistory([])).toMatchObject({ count: 0, overall: null, lastStep: null });
  const one = summarizeHistory([entry("t1", score(1))]);
  expect(one).toMatchObject({ count: 1, overall: null, lastStep: null });
});

test("summarizeHistory: overall spans first->latest, lastStep spans prev->latest", () => {
  const h = [
    entry("t1", score(1.0)),
    entry("t2", score(0.9)),
    entry("t3", score(0.95)),
  ];
  const s = summarizeHistory(h);
  expect(s.count).toBe(3);
  // first 1.0 -> latest 0.95 is a net regression over the window...
  expect(s.overall!.verdict).toBe("regressed");
  // ...but the last step 0.9 -> 0.95 is an improvement.
  expect(s.lastStep!.verdict).toBe("improved");
});

test("formatHistorySummary renders empty / baseline / trend", () => {
  expect(formatHistorySummary(summarizeHistory([]))).toMatch(/no entries yet/);
  expect(formatHistorySummary(summarizeHistory([entry("t1", score(1))]))).toMatch(/no trend yet/);
  const trend = formatHistorySummary(
    summarizeHistory([entry("t1", score(1)), entry("t2", score(1))]),
  );
  expect(trend).toMatch(/2 entries/);
  expect(trend).toMatch(/overall:\s+unchanged/);
});
