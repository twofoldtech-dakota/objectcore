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

test("serialize -> parse round-trips hostile single-line content (colons, quotes, unicode)", () => {
  const hostile: KnowledgeEntry = {
    ...sample,
    id: "hostile-entry",
    title: 'A title: with "quotes", [brackets], émojis 🎯, and --- dashes',
    tags: ["with space", "ünïcode", "a-b_c"],
    source: "plans/008: §2 — \"the loop\"",
    body: "Body with ---\nand a fake\ntitle: not-frontmatter\n",
  };
  expect(parseEntry(hostile.id, serializeEntry(hostile))).toEqual(hostile);
});

test("serializeEntry rejects newlines in single-line fields instead of emitting a corrupt form", () => {
  expect(() => serializeEntry({ ...sample, title: "one\ntwo" })).toThrow(/single-line/);
  expect(() => serializeEntry({ ...sample, source: "a\r\nb" })).toThrow(/single-line/);
  expect(() => serializeEntry({ ...sample, created: "2026-\n06-26" })).toThrow(/single-line/);
});

test("serializeEntry rejects tags that would not survive parseTags", () => {
  expect(() => serializeEntry({ ...sample, tags: ["a,b"] })).toThrow(/tag/);
  expect(() => serializeEntry({ ...sample, tags: ["[x]"] })).toThrow(/tag/);
  expect(() => serializeEntry({ ...sample, tags: [" padded "] })).toThrow(/tag/);
  expect(() => serializeEntry({ ...sample, tags: [""] })).toThrow(/tag/);
});

test("renderIndex escapes link-text brackets so a bracketed title stays a valid link", () => {
  const out = renderIndex([{ ...sample, title: "About [brackets] here" }]);
  expect(out).toContain("- [About \\[brackets\\] here](entries/sample-lesson.md)");
});

test("parseEntry rejects an invalid type", () => {
  const bad = "---\nid: x\ntype: nope\ntitle: t\ncreated: 2026-06-26\n---\nbody\n";
  expect(() => parseEntry("x", bad)).toThrow();
});
