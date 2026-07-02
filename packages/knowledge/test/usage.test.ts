// Usage-log parse / serialize / aggregate (plan 013 WP5). PURE — no I/O; the JSONL
// file edges live in scripts/kb-cite.ts + scripts/kb-stats.ts. Covers the round-trip
// (incl. CRLF + blank-line skip + no-source), line-numbered parse errors, the
// reject-unknown posture, and aggregation (count + max-citedAt lastCited).

import { test, expect } from "bun:test";
import { parseUsageLog, serializeUsageEvent, aggregateUsage } from "../src/index";
import type { UsageEvent } from "../src/index";

// --- round-trip ---

test("serialize → parse round-trip (with source and without)", () => {
  const withSource: UsageEvent = {
    citedAt: "2026-07-02T12:00:00.000Z",
    id: "storage-is-a-port",
    source: "reflection:gate-red",
  };
  const noSource: UsageEvent = { citedAt: "2026-07-02T13:00:00.000Z", id: "components-at-root" };
  const text = [serializeUsageEvent(withSource), serializeUsageEvent(noSource)].join("\n");
  expect(parseUsageLog(text)).toEqual([withSource, noSource]);
});

test("serializeUsageEvent emits stable key order citedAt, id, source", () => {
  const e: UsageEvent = { citedAt: "2026-07-02T12:00:00.000Z", id: "x-y", source: "s" };
  expect(serializeUsageEvent(e)).toBe('{"citedAt":"2026-07-02T12:00:00.000Z","id":"x-y","source":"s"}');
});

test("a no-source event omits the source key entirely", () => {
  const e: UsageEvent = { citedAt: "2026-07-02T12:00:00.000Z", id: "x-y" };
  expect(serializeUsageEvent(e)).toBe('{"citedAt":"2026-07-02T12:00:00.000Z","id":"x-y"}');
});

test("parseUsageLog is CRLF-tolerant and skips blank lines", () => {
  const a = serializeUsageEvent({ citedAt: "2026-07-01T00:00:00.000Z", id: "a-b" });
  const b = serializeUsageEvent({ citedAt: "2026-07-02T00:00:00.000Z", id: "c-d" });
  const text = `${a}\r\n\r\n${b}\r\n`;
  expect(parseUsageLog(text)).toEqual([
    { citedAt: "2026-07-01T00:00:00.000Z", id: "a-b" },
    { citedAt: "2026-07-02T00:00:00.000Z", id: "c-d" },
  ]);
});

test("empty and whitespace-only text → []", () => {
  expect(parseUsageLog("")).toEqual([]);
  expect(parseUsageLog("   \n\r\n  ")).toEqual([]);
});

// --- line-numbered parse errors ---

test("a bad JSON line throws naming the 1-based line number", () => {
  const good = serializeUsageEvent({ citedAt: "2026-07-01T00:00:00.000Z", id: "a-b" });
  expect(() => parseUsageLog(`${good}\nnot json`)).toThrow(/line 2/);
});

test("the line number counts skipped blank lines (points at the real file line)", () => {
  // physical: line 1 blank (skipped), line 2 good, line 3 bad.
  const good = serializeUsageEvent({ citedAt: "2026-07-01T00:00:00.000Z", id: "a-b" });
  expect(() => parseUsageLog(`\n${good}\n{bad`)).toThrow(/line 3/);
});

test("a non-object line (number / string / array) is rejected", () => {
  expect(() => parseUsageLog("42")).toThrow(/line 1/);
  expect(() => parseUsageLog('"a string"')).toThrow(/line 1/);
  expect(() => parseUsageLog("[1,2]")).toThrow(/line 1/);
});

// --- reject-unknown posture + field validation ---

test("an unknown key is rejected", () => {
  const text = '{"citedAt":"2026-07-01T00:00:00.000Z","id":"a-b","extra":1}';
  expect(() => parseUsageLog(text)).toThrow(/unknown key "extra"/);
});

test("a missing or blank citedAt is rejected", () => {
  expect(() => parseUsageLog('{"id":"a-b"}')).toThrow(/citedAt/);
  expect(() => parseUsageLog('{"citedAt":"","id":"a-b"}')).toThrow(/citedAt/);
});

test("a missing or non-kebab id is rejected", () => {
  expect(() => parseUsageLog('{"citedAt":"2026-07-01T00:00:00.000Z"}')).toThrow(/id/);
  expect(() => parseUsageLog('{"citedAt":"2026-07-01T00:00:00.000Z","id":"Not_Kebab"}')).toThrow(
    /id/,
  );
});

test("a non-string source is rejected", () => {
  expect(() =>
    parseUsageLog('{"citedAt":"2026-07-01T00:00:00.000Z","id":"a-b","source":7}'),
  ).toThrow(/source/);
});

// --- aggregation ---

test("aggregateUsage counts citations and takes the max citedAt as lastCited", () => {
  const events: UsageEvent[] = [
    { citedAt: "2026-07-01T00:00:00.000Z", id: "a-b" },
    { citedAt: "2026-07-03T00:00:00.000Z", id: "a-b" }, // newest — even though listed before the 07-02 one
    { citedAt: "2026-07-02T00:00:00.000Z", id: "a-b" },
    { citedAt: "2026-07-01T09:00:00.000Z", id: "c-d", source: "s" },
  ];
  const stats = aggregateUsage(events);
  expect(stats.get("a-b")).toEqual({ id: "a-b", cited: 3, lastCited: "2026-07-03T00:00:00.000Z" });
  expect(stats.get("c-d")).toEqual({ id: "c-d", cited: 1, lastCited: "2026-07-01T09:00:00.000Z" });
  expect(stats.size).toBe(2);
});

test("aggregateUsage of [] → an empty map", () => {
  expect(aggregateUsage([]).size).toBe(0);
});
