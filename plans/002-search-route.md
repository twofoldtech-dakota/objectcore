# Plan 002: Add a read-only `/v1/search` route over the derived catalog

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 1ba205f..HEAD -- packages/registry-core/src/index.ts packages/registry-core/src/derive.ts packages/registry-server/src/app.ts packages/registry-server/test/app.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (independent of plan 001; if both land, see Maintenance notes)
- **Category**: direction (additive route behind the frozen seam)
- **Planned at**: commit `1ba205f`, 2026-06-25

## Why this matters

Search is the second designed-but-unbuilt additive route (`CLAUDE.md` lists
`/v1/search` alongside telemetry, channels, and OIDC publish). It is the
cheapest to build correctly: every catalog entry already carries `name`,
`description`, `keywords`, and `category` (see the `copyIf` list in `derive.ts`),
so search is a **pure filter over the derived catalog** — no DB write path, no
schema change, no new storage. Building it now gives consumers a way to discover
plugins and establishes the pattern (pure function in the core, thin route in the
server) for the remaining routes. `/v1/marketplace.json` is untouched.

## Current state

- `packages/registry-core/src/derive.ts` — every entry already contains the
  searchable fields. The `copyIf` call (lines 60-70) copies these manifest fields
  into each `MarketplaceEntry`:
  `displayName, description, version, author, homepage, repository, license, keywords, category`.
- `packages/registry-core/src/types.ts` — `MarketplaceEntry` (lines 41-54) and
  `MarketplaceJson` (lines 57-64). Relevant fields:

```ts
export interface MarketplaceEntry {
  name: string;
  source: PluginSource;
  displayName?: string;
  description?: string;
  version?: string;
  // ...
  keywords?: string[];
  category?: string;
  // ...
}
export interface MarketplaceJson {
  name: string;
  owner: { name: string; email?: string };
  plugins: MarketplaceEntry[];
  // ...
}
```

- `packages/registry-core/src/index.ts` — the barrel. Whole file today:

```ts
export * from "./types";
export * from "./derive";
export * from "./tags";
export * from "./sources";
export * from "./sinks";
export * from "./schema";
export * from "./validate";
```

- `packages/registry-server/src/app.ts` — the adapter, two routes
  (`/v1/marketplace.json`, `/healthz`). See plan 001's "Current state" for the
  full file; the relevant fact is that the marketplace route does
  `const plugins = await opts.source.listPlugins(); const derive = …; return c.json(deriveCatalog(plugins, derive));`.

**Repo conventions to match:**
- **Pure logic goes in `@objectcore/registry-core`, zero dependencies.** The
  filter is pure, so it lives in a new core module and is unit-tested there. The
  route in `app.ts` stays a thin adapter that derives the catalog (exactly like
  the marketplace route) and calls the pure filter.
- Core modules are small, single-purpose, and re-exported from `index.ts` (see
  `tags.ts`, `schema.ts` for the size/shape to match).
- Tests use `bun:test` (`import { test, expect } from "bun:test"`). Core tests
  live in `packages/registry-core/test/` (see `derive.test.ts`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bunx tsc` | exit 0, no errors |
| All tests | `bun test` | all pass (currently 41) |
| Core search tests | `bun test packages/registry-core/test/search.test.ts` | all pass |
| Server tests | `bun test packages/registry-server/test/app.test.ts` | all pass |
| Catalog gate (unaffected) | `bun run check:catalog` | exit 0 |

## Scope

**In scope** (the only files you should modify or create):
- `packages/registry-core/src/search.ts` (create)
- `packages/registry-core/src/index.ts` (add one export line)
- `packages/registry-core/test/search.test.ts` (create)
- `packages/registry-server/src/app.ts` (add one route)
- `packages/registry-server/test/app.test.ts` (add route tests)

**Out of scope** (do NOT touch):
- `deriveCatalog` and `derive.ts` — search consumes its output; never fork the
  derivation.
- The `/v1/marketplace.json` route body and its output contract.
- Any persistence — search is computed per request over the derived catalog.
  Do not add caching, indexes, or a DB query.

## Git workflow

- Branch: `advisor/002-search-route`
- One commit, plain imperative message matching the repo.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Write the pure `searchCatalog` filter in the core

Create `packages/registry-core/src/search.ts`. Define a small query type and a
pure function that filters `MarketplaceJson.plugins`. Matching rules (keep them
simple and case-insensitive):
- `q` — substring match against `name`, `displayName`, `description`, and any
  `keywords` (match if it appears in any of them).
- `keyword` — entry must have this exact keyword (case-insensitive).
- `category` — entry's `category` equals this (case-insensitive).
- Multiple filters combine with AND. No query at all returns all entries.

Target shape:

```ts
// Pure search over a derived catalog. No I/O, no dependencies — the same posture
// as deriveCatalog: the route is a thin adapter over this function.
import type { MarketplaceEntry, MarketplaceJson } from "./types";

export interface SearchQuery {
  q?: string;
  keyword?: string;
  category?: string;
}

export interface SearchResult {
  query: SearchQuery;
  count: number;
  plugins: MarketplaceEntry[];
}

export function searchCatalog(catalog: MarketplaceJson, query: SearchQuery): SearchResult {
  const q = query.q?.trim().toLowerCase();
  const keyword = query.keyword?.trim().toLowerCase();
  const category = query.category?.trim().toLowerCase();

  const plugins = catalog.plugins.filter((e) => {
    if (q) {
      const hay = [e.name, e.displayName, e.description, ...(e.keywords ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (keyword && !(e.keywords ?? []).some((k) => k.toLowerCase() === keyword)) return false;
    if (category && (e.category ?? "").toLowerCase() !== category) return false;
    return true;
  });

  return { query, count: plugins.length, plugins };
}
```

Then add to `packages/registry-core/src/index.ts` a new line (keep the existing
lines):

```ts
export * from "./search";
```

**Verify**: `bunx tsc` → exit 0.

### Step 2: Unit-test the filter in the core

Create `packages/registry-core/test/search.test.ts`. Build a small
`MarketplaceJson` fixture inline (you can hand-write entries; you do NOT need to
call `deriveCatalog`) and assert each rule. Pattern after
`packages/registry-core/test/derive.test.ts` for imports and style.

Cover: q substring on description; q match on a keyword; `keyword` exact filter;
`category` filter; combined AND filter; empty query returns all; no match returns
`count: 0`.

```ts
import { test, expect } from "bun:test";
import { searchCatalog, type MarketplaceJson } from "../src/index";

const catalog: MarketplaceJson = {
  name: "objectcore",
  owner: { name: "Dakota" },
  plugins: [
    { name: "commit-craft", source: "commit-craft", description: "Write great git commit messages", keywords: ["git", "commits"], category: "workflow" },
    { name: "alpha-plugin", source: "alpha-plugin", description: "Alpha demo", keywords: ["demo"], category: "example" },
  ],
};

test("q matches a substring of the description", () => {
  expect(searchCatalog(catalog, { q: "commit" }).plugins.map((p) => p.name)).toEqual(["commit-craft"]);
});

test("q matches a keyword", () => {
  expect(searchCatalog(catalog, { q: "git" }).plugins.map((p) => p.name)).toEqual(["commit-craft"]);
});

test("keyword is an exact (case-insensitive) filter", () => {
  expect(searchCatalog(catalog, { keyword: "Demo" }).plugins.map((p) => p.name)).toEqual(["alpha-plugin"]);
});

test("category filters", () => {
  expect(searchCatalog(catalog, { category: "workflow" }).plugins.map((p) => p.name)).toEqual(["commit-craft"]);
});

test("filters combine with AND", () => {
  expect(searchCatalog(catalog, { q: "demo", category: "workflow" }).count).toBe(0);
});

test("an empty query returns all entries", () => {
  expect(searchCatalog(catalog, {}).count).toBe(2);
});
```

**Verify**: `bun test packages/registry-core/test/search.test.ts` → all pass.

### Step 3: Add the `/v1/search` route to the server adapter

In `packages/registry-server/src/app.ts`, import `searchCatalog` and add a route
**after** `/v1/marketplace.json` and before `/healthz`. It derives the catalog
exactly like the marketplace route, then filters. Read query params with
`c.req.query(...)`.

```ts
// add to the existing import from "@objectcore/registry-core":
//   deriveCatalog, searchCatalog, type CatalogSource, type DeriveOpts

  app.get("/v1/search", async (c) => {
    const plugins = await opts.source.listPlugins();
    const derive = typeof opts.derive === "function" ? await opts.derive() : opts.derive;
    const catalog = deriveCatalog(plugins, derive);
    return c.json(
      searchCatalog(catalog, {
        q: c.req.query("q"),
        keyword: c.req.query("keyword"),
        category: c.req.query("category"),
      }),
    );
  });
```

(`c.req.query("q")` returns `string | undefined`, which matches `SearchQuery`.)

**Verify**: `bunx tsc` → exit 0.

### Step 4: Route test

In `packages/registry-server/test/app.test.ts`, add a test that hits
`/v1/search?q=alpha` against the existing `fixture` and asserts it returns
`alpha-plugin`. Reuse the file's existing `fixture`, `base`, and `MockSource`.

```ts
test("GET /v1/search filters the derived catalog", async () => {
  const app = createApp({ source: new MockSource(fixture), derive: base });
  const res = await app.request("/v1/search?q=alpha");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { count: number; plugins: { name: string }[] };
  expect(body.plugins.map((p) => p.name)).toEqual(["alpha-plugin"]);
});
```

(The existing `fixture` has `alpha-plugin` with `description: "Alpha"` and
`beta-plugin` with `description: "Beta"`, so `q=alpha` matches only the first.)

**Verify**: `bun test packages/registry-server/test/app.test.ts` → all pass.

## Test plan

- New core tests: `packages/registry-core/test/search.test.ts` — the six rule
  cases in Step 2 (q-on-description, q-on-keyword, keyword exact, category,
  combined AND, empty-returns-all). Pattern: `derive.test.ts`.
- New server test: one route test in `app.test.ts` (Step 4).
- Verification: `bun test` → all pass, including the new tests.

## Done criteria

ALL must hold:

- [ ] `bunx tsc` exits 0
- [ ] `bun test` exits 0; `search.test.ts` exists with ≥6 passing tests; the new
      `/v1/search` route test passes
- [ ] `grep -rn "searchCatalog" packages/registry-core/src/index.ts` shows the
      export
- [ ] `bun run check:catalog` exits 0 (no plugin changes)
- [ ] The `/v1/marketplace.json` handler is unchanged
- [ ] Only the five in-scope files are created/modified (`git status`)
- [ ] `plans/README.md` status row for 002 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `derive.ts`'s `copyIf` list no longer includes `keywords`/`category`/
  `description` (the search fields would be absent from entries) — the "Current
  state" has drifted.
- `index.ts` does not match the excerpt (re-confirm the export pattern before
  editing).
- You find yourself wanting to add persistence, an index, or a second derivation
  path to make search work — search must be a pure filter over `deriveCatalog`'s
  output. If that seems insufficient, report why instead of building it.
- A verification command fails twice after a reasonable fix.

## Maintenance notes

- If plan 001 (channels) is also landed, a natural follow-up is a channel-aware
  search (`/v1/:channel/search`) reusing 001's `channels` resolver — explicitly
  **deferred** here; this plan searches the stable catalog only.
- The response shape `{ query, count, plugins }` is a new public contract. If you
  later paginate, add `limit`/`offset` to `SearchQuery` rather than changing the
  envelope.
- Reviewer should confirm `searchCatalog` stays dependency-free (no imports
  outside `./types`) so the core package's zero-dep guarantee holds.
