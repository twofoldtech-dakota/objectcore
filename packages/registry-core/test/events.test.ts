import { test, expect } from "bun:test";
import { parseEvent, aggregateEvents, type StoredEvent } from "../src/events";

test("parseEvent accepts a well-formed event (type + optional plugin/channel/meta)", () => {
  const r = parseEvent({
    type: "install",
    plugin: "hello-objectcore",
    channel: "stable",
    meta: { source: "cli", count: 3, first: true },
  });
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.event).toEqual({
      type: "install",
      plugin: "hello-objectcore",
      channel: "stable",
      meta: { source: "cli", count: 3, first: true },
    });
  }
});

test("parseEvent accepts a bare event with only a type (e.g. a search)", () => {
  const r = parseEvent({ type: "search" });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.event).toEqual({ type: "search" });
});

test("parseEvent rejects an unknown event type", () => {
  const r = parseEvent({ type: "explode" });
  expect(r.ok).toBe(false);
});

test("parseEvent rejects unknown top-level fields (strict, like schema.ts)", () => {
  const r = parseEvent({ type: "install", bogus: 1 });
  expect(r).toMatchObject({ ok: false, error: "unknown field: bogus" });
});

test("parseEvent rejects a non-kebab plugin/channel", () => {
  expect(parseEvent({ type: "install", plugin: "Not_Kebab" }).ok).toBe(false);
  expect(parseEvent({ type: "install", channel: "Stable!" }).ok).toBe(false);
});

test("parseEvent rejects a non-object / array body", () => {
  expect(parseEvent([]).ok).toBe(false);
  expect(parseEvent("install").ok).toBe(false);
  expect(parseEvent(null).ok).toBe(false);
});

test("parseEvent rejects non-primitive or oversized meta", () => {
  expect(parseEvent({ type: "install", meta: { nested: { a: 1 } } }).ok).toBe(false);
  expect(parseEvent({ type: "install", meta: { big: "x".repeat(600) } }).ok).toBe(false);
  const tooMany = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, i]));
  expect(parseEvent({ type: "install", meta: tooMany }).ok).toBe(false);
});

test("aggregateEvents counts by type and by plugin (ignoring pluginless events)", () => {
  const events: StoredEvent[] = [
    { type: "install", plugin: "alpha-plugin", at: "t" },
    { type: "install", plugin: "beta-plugin", at: "t" },
    { type: "activate", plugin: "alpha-plugin", at: "t" },
    { type: "search", at: "t" }, // no plugin
  ];
  expect(aggregateEvents(events)).toEqual({
    total: 4,
    byType: { install: 2, activate: 1, search: 1 },
    byPlugin: { "alpha-plugin": 2, "beta-plugin": 1 },
  });
});
