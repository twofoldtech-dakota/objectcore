import { test, expect } from "bun:test";
import { InMemoryEventStore } from "../src/events";

test("InMemoryEventStore records, counts, and reads back most-recent-first", async () => {
  let n = 0;
  const store = new InMemoryEventStore(() => `2026-01-01T00:00:0${n++}Z`);

  await store.record({ type: "install", plugin: "hello-objectcore" });
  await store.record({ type: "activate", plugin: "hello-objectcore", channel: "stable" });

  expect(await store.count()).toBe(2);
  const recent = await store.recent();
  expect(recent.map((e) => e.type)).toEqual(["activate", "install"]); // recent-first, like SQL ORDER BY id DESC
  expect(recent[0].at).toBe("2026-01-01T00:00:01Z");
  expect(recent[0]).toEqual({ type: "activate", plugin: "hello-objectcore", channel: "stable", at: "2026-01-01T00:00:01Z" });
});

test("InMemoryEventStore.recent honours the limit", async () => {
  const store = new InMemoryEventStore(() => "2026-01-01T00:00:00Z");
  for (let i = 0; i < 5; i++) await store.record({ type: "view", plugin: `p${i}` });
  expect((await store.recent(2)).length).toBe(2);
});

test("InMemoryEventStore.stats aggregates by type and plugin", async () => {
  const store = new InMemoryEventStore(() => "2026-01-01T00:00:00Z");
  await store.record({ type: "install", plugin: "hello-objectcore" });
  await store.record({ type: "install", plugin: "plugin-forge" });
  await store.record({ type: "activate", plugin: "hello-objectcore" });
  await store.record({ type: "search" });
  expect(await store.stats()).toEqual({
    total: 4,
    byType: { install: 2, activate: 1, search: 1 },
    byPlugin: { "hello-objectcore": 2, "plugin-forge": 1 },
  });
});
