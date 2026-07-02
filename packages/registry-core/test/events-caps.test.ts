// F31: meta KEYS are stored payload too — an unbounded key length on a (potentially
// tokenless) write path is a DB-flooding vector. Value length and key count were
// already capped; this locks the key-length dimension.

import { test, expect } from "bun:test";
import { parseEvent } from "../src/events";

test("parseEvent rejects a meta key longer than 64 chars", () => {
  const r = parseEvent({ type: "install", meta: { ["k".repeat(100)]: 1 } });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toMatch(/exceeds 64 chars/);
});

test("parseEvent accepts a meta key at the 64-char boundary", () => {
  const key = "k".repeat(64);
  const r = parseEvent({ type: "install", meta: { [key]: "v" } });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.event.meta).toEqual({ [key]: "v" });
});
