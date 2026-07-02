// Deterministic lexical retrieval (plan 013 WP3): the tokenizer, field weighting
// (title > tag > body), BM25-style IDF (rare > ubiquitous), the id-asc tie-break, the
// type/tag/archived filters, and the pure retrieval-case runner. The load-bearing
// property is DETERMINISM — the same corpus + query must rank identically every run,
// which is what makes the retrieval evals safe to run offline inside `bun run check`.

import { test, expect } from "bun:test";
import { tokenize, searchEntries, runRetrievalCases } from "../src/index";
import type { KnowledgeEntry } from "../src/index";

/** Build a KnowledgeEntry with sensible defaults; override only what a case needs. */
function mk(partial: Partial<KnowledgeEntry> & { id: string }): KnowledgeEntry {
  return {
    type: "lesson",
    title: `Entry ${partial.id}`,
    tags: [],
    created: "2026-06-26",
    body: "\n",
    ...partial,
  };
}

// --- tokenize ---------------------------------------------------------------------

test("tokenize lowercases and splits on non-alphanumeric runs", () => {
  expect(tokenize("foo.bar_baz-qux")).toEqual(["foo", "bar", "baz", "qux"]);
  expect(tokenize("Mixed CASE Words")).toEqual(["mixed", "case", "words"]);
});

test("tokenize drops the embedded stopwords", () => {
  // Every token here is a stopword (or a length-1 residue) → nothing survives.
  expect(tokenize("how do I do this")).toEqual([]);
  expect(tokenize("what is the plugin")).toEqual(["plugin"]);
});

test("tokenize drops length-<2 tokens", () => {
  expect(tokenize("x bb y dd 1")).toEqual(["bb", "dd"]);
});

// --- field weighting --------------------------------------------------------------

test("a title match outranks a body-only match", () => {
  const inTitle = mk({ id: "a", title: "alpha thing", body: "filler\n" });
  const inBody = mk({ id: "b", title: "plain", body: "alpha filler\n" });
  const hits = searchEntries([inBody, inTitle], "alpha");
  expect(hits.map((h) => h.id)).toEqual(["a", "b"]);
  expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
});

test("a tag match outranks a body-only match", () => {
  const inTag = mk({ id: "c", title: "one", tags: ["beta"], body: "filler\n" });
  const inBody = mk({ id: "d", title: "two", body: "beta filler\n" });
  const hits = searchEntries([inBody, inTag], "beta");
  expect(hits.map((h) => h.id)).toEqual(["c", "d"]);
  expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
});

test("an id token contributes (kebab id split on hyphens)", () => {
  const inId = mk({ id: "gamma-topic", title: "unrelated", body: "filler\n" });
  const noMatch = mk({ id: "other", title: "unrelated", body: "filler\n" });
  const hits = searchEntries([noMatch, inId], "gamma");
  expect(hits.map((h) => h.id)).toEqual(["gamma-topic"]);
});

// --- IDF: rare beats ubiquitous ---------------------------------------------------

test("a rare token outranks a ubiquitous one", () => {
  const corpus = [
    mk({ id: "e1", body: "rare filler\n" }),
    mk({ id: "e2", body: "common filler\n" }),
    mk({ id: "e3", body: "common filler\n" }),
    mk({ id: "e4", body: "common filler\n" }),
    mk({ id: "e5", body: "common filler\n" }),
  ];
  // Both query tokens match one entry each with identical weighted tf; only IDF differs.
  const hits = searchEntries(corpus, "rare common");
  expect(hits[0]!.id).toBe("e1"); // the rare-token entry wins
  const rare = hits.find((h) => h.id === "e1")!;
  const common = hits.find((h) => h.id === "e2")!;
  expect(rare.score).toBeGreaterThan(common.score);
});

// --- determinism + tie-break ------------------------------------------------------

test("two consecutive searches over the same corpus rank identically", () => {
  const corpus = [
    mk({ id: "p", title: "retrieval scoring", tags: ["search"], body: "ranking body\n" }),
    mk({ id: "q", title: "ranking search", body: "retrieval body\n" }),
    mk({ id: "r", title: "unrelated", body: "nothing here\n" }),
  ];
  const first = searchEntries(corpus, "retrieval ranking search");
  const second = searchEntries(corpus, "retrieval ranking search");
  expect(second).toEqual(first);
});

test("equal scores tie-break by id ascending", () => {
  // Identical fields except id → identical scores → deterministic id-asc order.
  const b = mk({ id: "b-id", body: "zzz\n" });
  const a = mk({ id: "a-id", body: "zzz\n" });
  const hits = searchEntries([b, a], "zzz");
  expect(hits.map((h) => h.id)).toEqual(["a-id", "b-id"]);
  expect(hits[0]!.score).toBe(hits[1]!.score);
});

// --- filters ----------------------------------------------------------------------

test("the type filter restricts the pool", () => {
  const corpus = [
    mk({ id: "g1", type: "gotcha", body: "delta\n" }),
    mk({ id: "l1", type: "lesson", body: "delta\n" }),
  ];
  const hits = searchEntries(corpus, "delta", { type: "gotcha" });
  expect(hits.map((h) => h.id)).toEqual(["g1"]);
});

test("the tag filter restricts the pool", () => {
  const corpus = [
    mk({ id: "t1", tags: ["keep"], body: "epsilon\n" }),
    mk({ id: "t2", tags: ["drop"], body: "epsilon\n" }),
  ];
  const hits = searchEntries(corpus, "epsilon", { tag: "keep" });
  expect(hits.map((h) => h.id)).toEqual(["t1"]);
});

test("archived entries are excluded by default and included with includeArchived", () => {
  const active = mk({ id: "act", body: "zeta\n" });
  const archived = mk({ id: "arc", status: "superseded", supersededBy: "act", body: "zeta\n" });
  const corpus = [active, archived];
  expect(searchEntries(corpus, "zeta").map((h) => h.id)).toEqual(["act"]);
  const withArchived = searchEntries(corpus, "zeta", { includeArchived: true }).map((h) => h.id);
  expect(withArchived.sort()).toEqual(["act", "arc"]);
});

test("k caps the number of hits", () => {
  const corpus = [
    mk({ id: "k1", body: "eta\n" }),
    mk({ id: "k2", body: "eta\n" }),
    mk({ id: "k3", body: "eta\n" }),
  ];
  expect(searchEntries(corpus, "eta", { k: 2 })).toHaveLength(2);
});

// --- zero hits --------------------------------------------------------------------

test("a query with no matching token returns []", () => {
  const corpus = [mk({ id: "z", title: "alpha", body: "beta\n" })];
  expect(searchEntries(corpus, "nonexistenttoken")).toEqual([]);
});

test("a query of only stopwords returns []", () => {
  const corpus = [mk({ id: "z", title: "the plugin", body: "the body\n" })];
  expect(searchEntries(corpus, "what is the")).toEqual([]);
});

// --- runRetrievalCases (the offline eval runner) ----------------------------------

test("runRetrievalCases reports ok per positive/negative case", () => {
  const corpus = [
    mk({ id: "theta-entry", title: "theta topic", body: "theta body\n" }),
    mk({ id: "iota-entry", title: "iota topic", body: "iota body\n" }),
  ];
  const results = runRetrievalCases(corpus, [
    { query: "theta", expectTop: "theta-entry" },
    { query: "nonexistenttoken", expectTop: null },
    { query: "iota", expectTop: "theta-entry" }, // deliberately wrong expectation
  ]);
  expect(results.map((r) => r.ok)).toEqual([true, true, false]);
  expect(results[2]!.actual).toBe("iota-entry");
});
