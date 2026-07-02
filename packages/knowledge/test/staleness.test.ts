// Staleness policy (plan 013 WP2): the pure `parseSourceRefs` parser over the messy
// live-corpus `source` strings, and the `assessStaleness` fresh/stale/unverifiable
// truth table. PURE — no I/O, no clock; `today` and all file/git evidence are
// injected. The parser cases are the REAL corpus shapes, tested verbatim.

import { test, expect } from "bun:test";
import { parseSourceRefs, assessStaleness } from "../src/index";
import type { KnowledgeEntry, PathEvidence, SourceRef } from "../src/index";

const TODAY = "2026-07-02"; // injected; v1 policy is anchor-relative so its value is inert

// --- parseSourceRefs: verbatim corpus shapes ---

test("parseSourceRefs: a plain path", () => {
  expect(parseSourceRefs("packages/forge/src/scaffold.ts")).toEqual([
    { raw: "packages/forge/src/scaffold.ts", kind: "path" },
  ]);
});

test("parseSourceRefs: a trailing parenthetical like (F4) strips", () => {
  expect(parseSourceRefs("packages/eval/src/coverage.ts (F4)")).toEqual([
    { raw: "packages/eval/src/coverage.ts", kind: "path" },
  ]);
});

test("parseSourceRefs: a no-space trailing parenthetical also strips", () => {
  expect(parseSourceRefs("packages/eval/src/coverage.ts(F4)")).toEqual([
    { raw: "packages/eval/src/coverage.ts", kind: "path" },
  ]);
});

test("parseSourceRefs: the composite semicolon+brace source yields 4 path refs (3 files + plans/008)", () => {
  // Real corpus source of the trigger-surface entry. The brace expands to two files;
  // `plans/008` is a 4th path-like token (contains '/') and is kept as a path ref.
  const src =
    "plans/008 F4; packages/eval/src/{coverage,delegation}.ts, packages/forge/src/scaffold.ts";
  const refs = parseSourceRefs(src);
  expect(refs).toEqual([
    { raw: "plans/008", kind: "path" },
    { raw: "packages/eval/src/coverage.ts", kind: "path" },
    { raw: "packages/eval/src/delegation.ts", kind: "path" },
    { raw: "packages/forge/src/scaffold.ts", kind: "path" },
  ]);
  // The 3 REAL files (the "exactly 3 path refs" from the plan) plus plans/008:
  expect(refs.filter((r) => r.raw.endsWith(".ts")).map((r) => r.raw)).toEqual([
    "packages/eval/src/coverage.ts",
    "packages/eval/src/delegation.ts",
    "packages/forge/src/scaffold.ts",
  ]);
});

test("parseSourceRefs: a leading-dot path is still a path", () => {
  expect(parseSourceRefs(".github/workflows/release.yml")).toEqual([
    { raw: ".github/workflows/release.yml", kind: "path" },
  ]);
});

test("parseSourceRefs: an http(s) URL is kind url (not path, even though it contains '/')", () => {
  expect(parseSourceRefs("https://code.claude.com/docs/en/plugins-reference")).toEqual([
    { raw: "https://code.claude.com/docs/en/plugins-reference", kind: "url" },
  ]);
  expect(parseSourceRefs("http://example.com/x")).toEqual([
    { raw: "http://example.com/x", kind: "url" },
  ]);
});

test("parseSourceRefs: undefined and empty yield []", () => {
  expect(parseSourceRefs(undefined)).toEqual([]);
  expect(parseSourceRefs("")).toEqual([]);
  expect(parseSourceRefs("   ")).toEqual([]);
});

test("parseSourceRefs: trims whitespace around a fragment", () => {
  expect(parseSourceRefs("  packages/a/b.ts  ")).toEqual([
    { raw: "packages/a/b.ts", kind: "path" },
  ]);
});

test("parseSourceRefs: drops bare prose tokens (no '/' and not a URL)", () => {
  expect(parseSourceRefs("F4")).toEqual([]);
  expect(parseSourceRefs("just some prose here")).toEqual([]);
  expect(parseSourceRefs("note; TODO")).toEqual([]);
  // A prose lead + a path second fragment: only the path survives.
  expect(parseSourceRefs("plan-013; packages/knowledge/src/staleness.ts")).toEqual([
    { raw: "packages/knowledge/src/staleness.ts", kind: "path" },
  ]);
});

test("parseSourceRefs: a mixed URL + path composite keeps both, correctly kinded", () => {
  const refs: SourceRef[] = parseSourceRefs(
    "https://code.claude.com/docs, packages/forge/src/scaffold.ts",
  );
  expect(refs).toEqual([
    { raw: "https://code.claude.com/docs", kind: "url" },
    { raw: "packages/forge/src/scaffold.ts", kind: "path" },
  ]);
});

// --- assessStaleness: truth table ---

function entry(over: Partial<KnowledgeEntry>): KnowledgeEntry {
  return {
    id: "e",
    type: "lesson",
    title: "t",
    tags: [],
    created: "2026-06-01",
    body: "b\n",
    ...over,
  };
}

test("anchor preference order: verifiedAt > updated > created", () => {
  const ev: PathEvidence[] = [{ path: "a/b.ts", exists: true, lastModified: "2026-05-01" }];
  // All three present → verifiedAt wins.
  expect(
    assessStaleness(
      entry({ verifiedAt: "2026-07-02", updated: "2026-07-01", created: "2026-06-01" }),
      ev,
      TODAY,
    ).anchor,
  ).toBe("2026-07-02");
  // No verifiedAt → updated wins.
  expect(
    assessStaleness(entry({ updated: "2026-07-01", created: "2026-06-01" }), ev, TODAY).anchor,
  ).toBe("2026-07-01");
  // Neither → created.
  expect(assessStaleness(entry({ created: "2026-06-01" }), ev, TODAY).anchor).toBe("2026-06-01");
});

test("extensioned path missing → stale (source file missing)", () => {
  const a = assessStaleness(
    entry({ created: "2026-06-01" }),
    [{ path: "packages/x/y.ts", exists: false }],
    TODAY,
  );
  expect(a.freshness).toBe("stale");
  expect(a.reason).toBe("source file missing: packages/x/y.ts");
});

test("existing path changed after anchor → stale", () => {
  const a = assessStaleness(
    entry({ created: "2026-06-01" }),
    [{ path: "packages/x/y.ts", exists: true, lastModified: "2026-07-01" }],
    TODAY,
  );
  expect(a.freshness).toBe("stale");
  expect(a.reason).toContain("source changed after last verification: packages/x/y.ts");
  expect(a.reason).toContain("2026-07-01 > 2026-06-01");
});

test("same-day boundary (lastModified === anchor) → fresh (not drift)", () => {
  const a = assessStaleness(
    entry({ verifiedAt: "2026-07-01" }),
    [{ path: "packages/x/y.ts", exists: true, lastModified: "2026-07-01" }],
    TODAY,
  );
  expect(a.freshness).toBe("fresh");
});

test("existing path with NO git date → fresh (existence signal alone), not stale", () => {
  const a = assessStaleness(
    entry({ created: "2026-06-01" }),
    [{ path: "packages/x/y.ts", exists: true }],
    TODAY,
  );
  expect(a.freshness).toBe("fresh");
  expect(a.reason).toContain("packages/x/y.ts");
});

test("URL-only (no path evidence) → unverifiable", () => {
  const a = assessStaleness(entry({ created: "2026-06-01" }), [], TODAY);
  expect(a.freshness).toBe("unverifiable");
  expect(a.reason).toContain("URL or prose");
  expect(a.anchor).toBe("2026-06-01"); // anchor is still reported
});

test("extensionless-missing only (plans/008) → unverifiable, NOT stale", () => {
  const a = assessStaleness(
    entry({ created: "2026-06-01" }),
    [{ path: "plans/008", exists: false }],
    TODAY,
  );
  expect(a.freshness).toBe("unverifiable");
  expect(a.reason).toContain("plans/008");
});

test("empty source (no evidence) → unverifiable", () => {
  expect(assessStaleness(entry({}), [], TODAY).freshness).toBe("unverifiable");
});

test("extensioned-missing takes precedence over a present-fresh sibling → stale", () => {
  const a = assessStaleness(
    entry({ created: "2026-06-01" }),
    [
      { path: "packages/x/present.ts", exists: true, lastModified: "2026-05-01" },
      { path: "packages/x/gone.ts", exists: false },
    ],
    TODAY,
  );
  expect(a.freshness).toBe("stale");
  expect(a.reason).toBe("source file missing: packages/x/gone.ts");
});

test("extensionless-missing alongside a present source → fresh (shorthand absence is not drift)", () => {
  const a = assessStaleness(
    entry({ created: "2026-06-01" }),
    [
      { path: "plans/008", exists: false },
      { path: "packages/x/y.ts", exists: true, lastModified: "2026-05-01" },
    ],
    TODAY,
  );
  expect(a.freshness).toBe("fresh");
});

// --- Multi-path reasons: a composite-source entry names ALL its deciding paths ---

test("stale reason lists ALL changed paths and the NEWEST date vs the anchor", () => {
  const a = assessStaleness(
    entry({ created: "2026-06-26" }),
    [
      { path: "packages/eval/src/coverage.ts", exists: true, lastModified: "2026-07-01" },
      { path: "packages/eval/src/delegation.ts", exists: true, lastModified: "2026-07-02" },
      { path: "packages/forge/src/scaffold.ts", exists: true, lastModified: "2026-06-30" },
    ],
    TODAY,
  );
  expect(a.freshness).toBe("stale");
  expect(a.reason).toBe(
    "source changed after last verification: packages/eval/src/coverage.ts, " +
      "packages/eval/src/delegation.ts, packages/forge/src/scaffold.ts (2026-07-02 > 2026-06-26)",
  );
});

test("missing reason lists ALL missing extensioned files", () => {
  const a = assessStaleness(
    entry({ created: "2026-06-01" }),
    [
      { path: "packages/a/gone.ts", exists: false },
      { path: "packages/b/also-gone.ts", exists: false },
    ],
    TODAY,
  );
  expect(a.freshness).toBe("stale");
  expect(a.reason).toBe("source file missing: packages/a/gone.ts, packages/b/also-gone.ts");
});
