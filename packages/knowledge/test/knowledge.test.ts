import { test, expect } from "bun:test";
import {
  parseEntry,
  serializeEntry,
  renderIndex,
  checkIndexBudget,
} from "../src/index";
import type { KnowledgeEntry } from "../src/index";

const sample: KnowledgeEntry = {
  id: "sample-lesson",
  type: "lesson",
  title: "A sample lesson",
  tags: ["a", "b"],
  source: "plan-008",
  created: "2026-06-26",
  body: "Body line one.\n",
};

test("serialize -> parse round-trips an entry", () => {
  const round = parseEntry(sample.id, serializeEntry(sample));
  expect(round).toEqual(sample);
});

test("parse tolerates CRLF and a missing optional source", () => {
  const noSource: KnowledgeEntry = { ...sample, source: undefined };
  const crlf = serializeEntry(noSource).replace(/\n/g, "\r\n");
  expect(parseEntry(noSource.id, crlf)).toEqual(noSource);
});

test("renderIndex is deterministic, groups by type, sorts by id", () => {
  const b = { ...sample, id: "b-entry", title: "B" };
  const a = { ...sample, id: "a-entry", title: "A" };
  const out = renderIndex([b, a]);
  expect(out.indexOf("a-entry")).toBeLessThan(out.indexOf("b-entry"));
  expect(renderIndex([b, a])).toBe(out); // pure / stable
});

test("checkIndexBudget flags overflow", () => {
  expect(checkIndexBudget("short\n").ok).toBe(true);
  expect(checkIndexBudget("x\n".repeat(300)).ok).toBe(false);
});

test("parseEntry rejects an invalid type", () => {
  const bad = "---\nid: x\ntype: nope\ntitle: t\ncreated: 2026-06-26\n---\nbody\n";
  expect(() => parseEntry("x", bad)).toThrow();
});
