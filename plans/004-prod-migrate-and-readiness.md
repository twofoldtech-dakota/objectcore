# Plan 004: Migrate the DB on prod boot and add a DB-touching `/readyz` (deploy safety)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 1ba205f..HEAD -- packages/registry-server/src/app.ts packages/registry-server/src/prod.ts packages/registry-server/test/app.test.ts fly.toml`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. **Note:** plan 001 also edits
> `app.ts`/`prod.ts`/`app.test.ts`. If 001 has already landed, those files will
> differ from the excerpts here — that is expected; ADD the changes below, do not
> revert 001's `channels` additions. See "Coordination with plan 001".

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (but coordinate edits with plan 001 — same files)
- **Category**: bug (deploy-time correctness)
- **Planned at**: commit `1ba205f`, 2026-06-25

## Why this matters

As of 2026-06-25 the `DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `FLY_API_TOKEN`
secrets are all set, so `deploy.yml` is **armed** — the next push to main runs a
real `flyctl deploy`, and the prod server (`prod.ts` in DB mode) boots against
Turso. Two gaps make that unsafe:

1. **The schema is never migrated on boot.** `prod.ts`'s `dbApp()` constructs a
   `RegistryDbSource` but never calls `store.migrate()`. The schema is created
   only as a side effect of `registry:ingest` (which calls `migrate()`). So a
   deploy that happens *before* any successful ingest serves SQL errors — the
   query in `LibSqlCatalogStore.listLatest` hits non-existent `channels` /
   `plugin_versions` tables and `/v1/marketplace.json` returns 500.
2. **The health check is shallow.** `/healthz` returns `{ ok: true }` without
   touching the DB, and `fly.toml` points its HTTP check at `/healthz`. So Fly
   considers the machine healthy even when every catalog request is 500ing —
   no restart, no alert.

This plan makes boot self-migrating (idempotent) and adds a readiness probe that
actually exercises the DB, so Fly's health check reflects whether the service can
serve its one job.

## Current state

- `packages/registry-server/src/app.ts` — the adapter. `createApp` takes
  `{ source, derive }` and registers `/v1/marketplace.json` and a shallow
  `/healthz`:

```ts
  app.get("/healthz", (c) => c.json({ ok: true }));
  return app;
}
```

- `packages/registry-server/src/prod.ts` — prod entry. Relevant parts:

```ts
const mode = process.env.OBJECTCORE_SOURCE ?? "db";
const channel = process.env.OBJECTCORE_CHANNEL ?? "stable";
const port = Number(process.env.PORT ?? 8080);

function dbApp(): Hono {
  // cache rows ~5s so listPlugins() + pins() in one request hit the DB once.
  const source = new RegistryDbSource(LibSqlCatalogStore.fromEnv(), channel, 5000);
  console.log(`ObjectCore registry (prod/db) -> :${port} [channel=${channel}]`);
  return createApp({ source, derive: async () => ({ ...base, ...(await source.pins()) }) });
}

const app = mode === "file" ? fileApp() : dbApp();
export default { port, fetch: app.fetch };
```

  `LibSqlCatalogStore.fromEnv()` returns the store; the store has an idempotent
  `async migrate()` (it runs `CREATE TABLE IF NOT EXISTS …`, see
  `packages/registry-db/src/store.ts:21-23` and `schema.ts`). `prod.ts` uses
  top-level code in a Bun module, so **top-level `await` is available**.

- `fly.toml` — the HTTP health check currently targets `/healthz`:

```toml
  [[http_service.checks]]
    path = "/healthz"
    interval = "30s"
    timeout = "5s"
    grace_period = "10s"
```

- `packages/registry-server/test/app.test.ts` — uses an in-memory
  `MockSource implements CatalogSource` and `app.request(...)`. The healthz test:

```ts
test("GET /healthz", async () => {
  const app = createApp({ source: new MockSource([]), derive: base });
  const res = await app.request("/healthz");
  expect(await res.json()).toEqual({ ok: true });
});
```

**Repo conventions to match:**
- `createApp` stays a thin adapter; the readiness *check function* is injected
  (same ports-and-adapters style as `source`/`derive`). Keep `/healthz` as a
  cheap liveness probe (process is up); `/readyz` is the readiness probe (can it
  reach its dependency).
- `migrate()` is idempotent — calling it on every boot is safe and cheap.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bunx tsc` | exit 0 |
| All tests | `bun test` | all pass |
| Server tests | `bun test packages/registry-server/test/app.test.ts` | all pass |
| Catalog gate (unaffected) | `bun run check:catalog` | exit 0 |

## Coordination with plan 001

Plan 001 adds an optional `channels` resolver to `ServerOpts` and a
`/v1/:channel/marketplace.json` route in the same two files. This plan adds an
optional `ready` checker and a `/readyz` route. They are **additive and
independent** — different optional fields, different routes. If 001 landed first,
keep its additions and add yours alongside. If you land first, 001's executor
will do the same. Never delete the other plan's field or route.

## Scope

**In scope** (the only files you should modify):
- `packages/registry-server/src/app.ts`
- `packages/registry-server/src/prod.ts`
- `packages/registry-server/test/app.test.ts`
- `fly.toml`

**Out of scope** (do NOT touch):
- `packages/registry-core/**` and `packages/registry-db/**` — `migrate()` already
  exists and is idempotent; do not change the schema or the store.
- `scripts/registry-ingest.ts` — it already migrates; leave it.
- `dev.ts` — the Git dev loop has no DB; readiness/migration are DB-mode concerns.
- The `/v1/marketplace.json` route and its output contract.

## Git workflow

- Branch: `advisor/004-prod-migrate-and-readiness`
- One commit, plain imperative message matching the repo.
- Do NOT push or open a PR unless the operator instructed it. (Reminder: pushing
  to main triggers the armed `deploy.yml`.)

## Steps

### Step 1: Add an optional readiness checker and `/readyz` route to `createApp`

In `packages/registry-server/src/app.ts`, add an optional `ready` to `ServerOpts`
and register `/readyz`. Keep `/healthz` exactly as-is (liveness).

```ts
export interface ServerOpts {
  source: CatalogSource;
  derive: DeriveOpts | (() => DeriveOpts | Promise<DeriveOpts>);
  /** Optional readiness probe: returns true when the backing dependency (e.g. the
   *  registry DB) is reachable. Wired in prod; omitted in dev/tests defaults ready. */
  ready?: () => Promise<boolean>;
  // (plan 001 may also add `channels?` here — keep both)
}
```

Add the route (after `/healthz`, before `return app;`):

```ts
  app.get("/readyz", async (c) => {
    if (!opts.ready) return c.json({ ready: true });
    try {
      return (await opts.ready())
        ? c.json({ ready: true })
        : c.json({ ready: false }, 503);
    } catch (err) {
      return c.json({ ready: false, error: String(err) }, 503);
    }
  });
```

**Verify**: `bunx tsc` → exit 0.

### Step 2: Migrate on boot and wire readiness in `prod.ts`

In `packages/registry-server/src/prod.ts`, make `dbApp()` async: build the store,
`await store.migrate()` (idempotent — creates the schema if a fresh DB), then
construct the source and pass a `ready` that does a lightweight DB read. Await it
at the top level.

```ts
async function dbApp(): Promise<Hono> {
  const store = LibSqlCatalogStore.fromEnv();
  await store.migrate(); // idempotent: a fresh Turso DB gets its schema before first serve
  const source = new RegistryDbSource(store, channel, 5000);
  console.log(`ObjectCore registry (prod/db) -> :${port} [channel=${channel}]`);
  return createApp({
    source,
    derive: async () => ({ ...base, ...(await source.pins()) }),
    ready: async () => {
      await store.listLatest(channel); // throws if the DB is unreachable / schema missing
      return true;
    },
  });
}

const app = mode === "file" ? fileApp() : await dbApp();
export default { port, fetch: app.fetch };
```

`fileApp()` stays synchronous; only the `db` branch is awaited. (If plan 001
landed, `dbApp` already builds a `sourceFor` helper — keep it; just add
`await store.migrate()` after constructing `store`, and add the `ready` field.)

**Verify**: `bunx tsc` → exit 0.

### Step 3: Point Fly's health check at `/readyz`

In `fly.toml`, change the check path from `/healthz` to `/readyz` so Fly's HTTP
check fails (and the machine is replaced / not rotated in) when the DB is
unreachable:

```toml
  [[http_service.checks]]
    path = "/readyz"
    interval = "30s"
    timeout = "5s"
    grace_period = "10s"
```

Leave `grace_period`/`interval`/`timeout` as they are. (`/healthz` remains
available as a cheap liveness endpoint; we just don't gate Fly on it.)

**Verify**: `grep -n "/readyz" fly.toml` → shows the path line; `grep -c "/healthz" fly.toml` → `0`.

### Step 4: Tests for `/readyz`

In `packages/registry-server/test/app.test.ts`, add tests for the ready/not-ready
branches and the default. Reuse `MockSource`, `base`, the existing imports.

```ts
test("GET /readyz returns 200 when ready() resolves true", async () => {
  const app = createApp({ source: new MockSource([]), derive: base, ready: async () => true });
  const res = await app.request("/readyz");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ready: true });
});

test("GET /readyz returns 503 when ready() throws", async () => {
  const app = createApp({
    source: new MockSource([]),
    derive: base,
    ready: async () => { throw new Error("db down"); },
  });
  const res = await app.request("/readyz");
  expect(res.status).toBe(503);
});

test("GET /readyz defaults to ready when no checker is wired", async () => {
  const app = createApp({ source: new MockSource([]), derive: base });
  const res = await app.request("/readyz");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ready: true });
});
```

**Verify**: `bun test packages/registry-server/test/app.test.ts` → all pass.

## Test plan

- New tests in `app.test.ts`: `/readyz` ready (200), not-ready/throws (503),
  default-no-checker (200). Pattern: the existing `/healthz` test.
- The migrate-on-boot path runs only against a real DB and is not unit-tested
  here (it would need a libSQL connection). `migrate()` itself is covered
  indirectly by `packages/registry-db/test/store.test.ts`. Manual verification is
  in Maintenance notes.
- Verification: `bun test` → all pass, including the 3 new tests.

## Done criteria

ALL must hold:

- [ ] `bunx tsc` exits 0
- [ ] `bun test` exits 0; the 3 new `/readyz` tests pass
- [ ] `prod.ts` calls `await store.migrate()` before serving in DB mode
      (`grep -n "store.migrate" packages/registry-server/src/prod.ts` → 1 match)
- [ ] `fly.toml` health check path is `/readyz`; `grep -c "/healthz" fly.toml` → 0
- [ ] `bun run check:catalog` exits 0 (no plugin changes)
- [ ] The `/v1/marketplace.json` and `/healthz` handlers are unchanged
- [ ] Only the four in-scope files are modified; plan 001's additions (if present)
      are intact (`git status`, `git diff`)
- [ ] `plans/README.md` status row for 004 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `prod.ts` or `app.ts` does not match the "Current state" excerpts AND plan 001
  is not the reason (i.e. an unexpected drift, not 001's known additions).
- `LibSqlCatalogStore` no longer exposes an idempotent `migrate()` (check
  `packages/registry-db/src/store.ts`) — the schema lifecycle changed.
- Top-level `await` in `prod.ts` causes a runtime/parse error under the repo's Bun
  version — report it; do not restructure the export into a callback.
- A verification command fails twice after a reasonable fix.

## Maintenance notes

- **Manual smoke (optional, needs a DB):** `DATABASE_URL=file:./tmp-readyz.db
  OBJECTCORE_SOURCE=db bun run packages/registry-server/src/prod.ts` then
  `curl localhost:8080/readyz` → `{"ready":true}` and
  `curl localhost:8080/v1/marketplace.json` → 200 with an (empty) catalog. Delete
  `tmp-readyz.db` after. This proves boot-migrate works against a fresh DB.
- If a future change moves migrations to an explicit release step (e.g. a
  dedicated migrate job in `deploy.yml`), the boot-time `migrate()` can become a
  no-op but should stay as a safety net unless that job is guaranteed to run first.
- Reviewer should confirm `/healthz` is unchanged (liveness) and only `/readyz`
  gates Fly, and that `deriveCatalog`/the catalog contract were not touched.
- Liveness vs readiness: if you later add a separate Fly `[checks]` for liveness,
  point it at `/healthz`; keep `/readyz` for the HTTP service check.
