# Plan 001: Serve per-channel catalogs at `/v1/:channel/marketplace.json` (canary channel)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat fd344a4..HEAD -- packages/registry-server/src/app.ts packages/registry-server/src/prod.ts packages/registry-server/test/app.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> **Reconciled 2026-06-25 after plan 004 landed.** Plan 004 added an optional
> `ready?` field to `ServerOpts`, a `/readyz` route, and made `dbApp()` async
> (boot-time `store.migrate()` + a `ready` checker). The "Current state" excerpts
> below already reflect that. Your job is to add the `channels` resolver
> *alongside* 004's additions — never remove `ready?`, `/readyz`, the
> `await store.migrate()`, or the `ready` wiring.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction (additive route behind the frozen seam)
- **Planned at**: commit `fd344a4` (reconciled after plan 004), 2026-06-25

## Why this matters

ObjectCore's whole design is "additive features slot in behind the frozen
`/v1/marketplace.json` seam without changing the contract." The **channels**
data model is already fully built — there is a `channels` table, the
`RegistryDbSource` already takes a `channel` constructor arg, `prod.ts` already
reads `OBJECTCORE_CHANNEL`, and `RegistryDbSink.setChannel` already writes
per-channel rows. **The only missing piece is an HTTP route** that lets a
consumer fetch a non-stable channel (e.g. a `canary` pre-release catalog). This
plan adds that route. It is the lowest-risk way to prove the additive-route
pattern, and it unlocks canary/pre-release distribution. `/v1/marketplace.json`
stays byte-for-byte unchanged (it is the `stable` channel).

## Current state

The HTTP adapter is a single-source Hono app. After plan 004 it exposes three
routes (`/v1/marketplace.json`, `/healthz`, `/readyz`) and `ServerOpts` carries
an optional `ready?` checker.

- `packages/registry-server/src/app.ts` — the adapter (post-004):

```ts
// packages/registry-server/src/app.ts (whole file)
import { Hono } from "hono";
import { deriveCatalog, type CatalogSource, type DeriveOpts } from "@objectcore/registry-core";

export interface ServerOpts {
  source: CatalogSource;
  derive: DeriveOpts | (() => DeriveOpts | Promise<DeriveOpts>);
  /** Optional readiness probe (added by plan 004). KEEP IT. */
  ready?: () => Promise<boolean>;
}

export function createApp(opts: ServerOpts): Hono {
  const app = new Hono();

  app.get("/v1/marketplace.json", async (c) => {
    const plugins = await opts.source.listPlugins();
    const derive = typeof opts.derive === "function" ? await opts.derive() : opts.derive;
    return c.json(deriveCatalog(plugins, derive));
  });

  app.get("/healthz", (c) => c.json({ ok: true }));

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
  return app;
}
```

- `packages/registry-server/src/prod.ts` — the prod entry (post-004). `dbApp()`
  is now **async**: it builds the store, migrates on boot, builds one
  `RegistryDbSource` for the `stable` channel, and wires `ready`:

```ts
// packages/registry-server/src/prod.ts  (dbApp, post-004)
async function dbApp(): Promise<Hono> {
  const store = LibSqlCatalogStore.fromEnv();
  await store.migrate(); // idempotent: a fresh Turso DB gets its schema before first serve
  // cache rows ~5s so listPlugins() + pins() in one request hit the DB once.
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
where `channel = process.env.OBJECTCORE_CHANNEL ?? "stable"` and
`base = { name, owner, pluginRoot, schema }` (from `objectcore.config.json`).

- `RegistryDbSource` (in `packages/registry-core/src/sources.ts`) — already
  channel-aware. Its constructor is
  `constructor(store?, channel = "stable", cacheTtlMs = 0)`, it has
  `listPlugins()` and `pins()`, and both read `store.listLatest(this.channel)`.
  **No change needed here** — you construct one source per channel.

- The **write side already exists**: `scripts/registry-ingest.ts` reads
  `OBJECTCORE_CHANNEL` and `RegistryDbSink` writes to that channel. Publishing to
  canary is `OBJECTCORE_CHANNEL=canary bun run registry:ingest` — **out of scope
  for this plan** (this plan is the read route only).

**Repo conventions to match:**
- Pure logic lives in `@objectcore/registry-core`; server files are thin
  adapters. This route is pure wiring, so it belongs in `app.ts`.
- Tests use an in-memory `MockSource implements CatalogSource` — see
  `packages/registry-server/test/app.test.ts:13-23`. Match that style; do **not**
  require a real DB in tests.
- Comments in this repo explain *why* (the seam, the relocation-not-rewrite
  doctrine), not *what*. Keep that tone if you add comments.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bunx tsc` | exit 0, no errors |
| All tests | `bun test` | all pass (currently 44 after plan 004) |
| This file's tests | `bun test packages/registry-server/test/app.test.ts` | all pass |
| Catalog gate (unaffected) | `bun run check:catalog` | exit 0, "in sync" |

## Scope

**In scope** (the only files you should modify):
- `packages/registry-server/src/app.ts`
- `packages/registry-server/src/prod.ts`
- `packages/registry-server/test/app.test.ts`

**Out of scope** (do NOT touch):
- `packages/registry-core/src/**` — `RegistryDbSource` is already channel-aware;
  no core change is needed. If you think you need one, STOP and report.
- `packages/registry-server/src/dev.ts` — the dev loop uses the Git source, which
  has no channel concept. Channels are a DB-mode (prod) feature. Leave dev as-is.
- `scripts/registry-ingest.ts` — the canary *write* path already works.
- The `/v1/marketplace.json` route body and its output — must stay byte-identical.

## Git workflow

- Branch: `advisor/001-channels-canary-route`
- Commit message style matches the repo (plain imperative, e.g.
  `git log` shows "Stage 3: operate the registry backend …"). One commit is fine.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add an optional channel resolver to `ServerOpts` and register the channel route

In `packages/registry-server/src/app.ts`, extend `ServerOpts` with an **optional**
`channels` resolver and register `/v1/:channel/marketplace.json` only when it is
provided. The default `/v1/marketplace.json` route is unchanged.

Target shape (keep the existing `ready?` field from plan 004 — add `channels?`
next to it):

```ts
export interface ServerOpts {
  source: CatalogSource;
  derive: DeriveOpts | (() => DeriveOpts | Promise<DeriveOpts>);
  /** Optional readiness probe (plan 004). KEEP. */
  ready?: () => Promise<boolean>;
  /** Optional: resolve a per-channel (source, derive) pair. When provided,
   *  GET /v1/:channel/marketplace.json serves that channel. Returning undefined
   *  for an unknown channel yields a 404. `/v1/marketplace.json` is unaffected —
   *  it is always the stable seam. */
  channels?: (channel: string) =>
    | { source: CatalogSource; derive: DeriveOpts | (() => DeriveOpts | Promise<DeriveOpts>) }
    | undefined;
}
```

In `createApp`, after the existing `/readyz` route and before `return app;`, add:

```ts
  if (opts.channels) {
    app.get("/v1/:channel/marketplace.json", async (c) => {
      const channel = c.req.param("channel");
      const resolved = opts.channels!(channel);
      if (!resolved) return c.json({ error: `unknown channel: ${channel}` }, 404);
      const plugins = await resolved.source.listPlugins();
      const derive =
        typeof resolved.derive === "function" ? await resolved.derive() : resolved.derive;
      return c.json(deriveCatalog(plugins, derive));
    });
  }
```

Factor out the shared "list → derive → json" body if you like, but it is only two
short blocks; duplication here is acceptable and clearer. Do not change the
existing `/v1/marketplace.json` handler.

**Verify**: `bunx tsc` → exit 0.

### Step 2: Wire the resolver in `prod.ts` (DB mode), restricted to an allowlist

In `packages/registry-server/src/prod.ts`, rework the **async** `dbApp()` (from
plan 004) so a single `sourceFor(channel)` helper builds a channel-scoped
`RegistryDbSource`, used for both the default stable seam and the channel
resolver. **Keep 004's `await store.migrate()` and the `ready` checker.** Restrict
resolvable channels to an env-driven allowlist so arbitrary `:channel` values
can't spin up unbounded DB sources.

Target shape (note it stays `async`, keeps `migrate()` and `ready`):

```ts
async function dbApp(): Promise<Hono> {
  const store = LibSqlCatalogStore.fromEnv();
  await store.migrate(); // (plan 004) idempotent: fresh Turso DB gets its schema before first serve
  // Allowlisted channels (comma-separated). "stable" is always served at the
  // bare /v1/marketplace.json seam; others are reachable at /v1/<channel>/marketplace.json.
  const allowed = new Set(
    (process.env.OBJECTCORE_CHANNELS ?? "stable,canary").split(",").map((s) => s.trim()).filter(Boolean),
  );
  const sourceFor = (ch: string) => {
    const src = new RegistryDbSource(store, ch, 5000);
    return { source: src, derive: async () => ({ ...base, ...(await src.pins()) }) };
  };
  const stable = sourceFor(channel); // `channel` = OBJECTCORE_CHANNEL ?? "stable"
  console.log(`ObjectCore registry (prod/db) -> :${port} [channel=${channel}, channels=${[...allowed].join(",")}]`);
  return createApp({
    ...stable,
    // (plan 004) readiness probe — touches the stable store. KEEP.
    ready: async () => {
      await store.listLatest(channel);
      return true;
    },
    channels: (ch) => (allowed.has(ch) ? sourceFor(ch) : undefined),
  });
}
```

The top-level `const app = mode === "file" ? fileApp() : await dbApp();` (from
plan 004) is already correct — leave it. Leave `fileApp()` untouched (break-glass
mode serves a single baked file; it has no channels).

**Verify**: `bunx tsc` → exit 0.

### Step 3: Test the channel route wiring with in-memory sources (no DB)

In `packages/registry-server/test/app.test.ts`, add tests that pass a `channels`
resolver returning **different fixtures per channel**, proving: the channel route
serves the right channel, the bare seam still serves stable, and an
unknown/disallowed channel 404s. Model the structure on the existing tests in
that file (they use `MockSource` and `app.request(...)`).

Add fixtures + tests like:

```ts
const canaryFixture: WorkspacePlugin[] = [
  { manifest: { name: "gamma-plugin", version: "2.0.0-rc.1", description: "Gamma RC" }, dir: "", relDir: "gamma-plugin" },
];

test("GET /v1/:channel/marketplace.json serves the resolved channel", async () => {
  const app = createApp({
    source: new MockSource(fixture),
    derive: base,
    channels: (ch) =>
      ch === "canary" ? { source: new MockSource(canaryFixture), derive: base } : undefined,
  });
  const res = await app.request("/v1/canary/marketplace.json");
  expect(res.status).toBe(200);
  const catalog = (await res.json()) as MarketplaceJson;
  expect(catalog.plugins.map((p) => p.name)).toEqual(["gamma-plugin"]);
});

test("the bare /v1/marketplace.json seam still serves stable when channels is set", async () => {
  const app = createApp({
    source: new MockSource(fixture),
    derive: base,
    channels: () => ({ source: new MockSource(canaryFixture), derive: base }),
  });
  const catalog = (await (await app.request("/v1/marketplace.json")).json()) as MarketplaceJson;
  expect(catalog.plugins.map((p) => p.name)).toEqual(["alpha-plugin", "beta-plugin"]);
});

test("an unknown channel 404s", async () => {
  const app = createApp({
    source: new MockSource(fixture),
    derive: base,
    channels: () => undefined,
  });
  const res = await app.request("/v1/nope/marketplace.json");
  expect(res.status).toBe(404);
});
```

`fixture`, `base`, `MockSource`, and the imports already exist at the top of the
file — reuse them; only add `canaryFixture` and the three tests.

**Verify**: `bun test packages/registry-server/test/app.test.ts` → all pass
(existing 6 after plan 004 + 3 new = 9).

## Test plan

- New tests (in `packages/registry-server/test/app.test.ts`, the existing suite):
  1. channel route serves the resolved channel's catalog,
  2. bare `/v1/marketplace.json` still serves stable when `channels` is set
     (proves the frozen seam is untouched),
  3. unknown/disallowed channel → 404.
- Structural pattern: the existing tests in the same file.
- Verification: `bun test` → all pass, including the 3 new tests.

## Done criteria

ALL must hold:

- [ ] `bunx tsc` exits 0
- [ ] `bun test` exits 0; the 3 new channel tests exist and pass
- [ ] `bun run check:catalog` exits 0 (this plan changes no plugins, so the
      committed `marketplace.json` is still in sync)
- [ ] `/v1/marketplace.json` handler body is unchanged from the "Current state"
      excerpt (diff it)
- [ ] Only the three in-scope files are modified (`git status`)
- [ ] `plans/README.md` status row for 001 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `packages/registry-server/src/app.ts` or `prod.ts` does not match the
  "Current state" excerpts (the codebase drifted since this plan was written).
- You find you need to change anything under `packages/registry-core/` — the
  source is already channel-aware; needing a core change means an assumption here
  is wrong.
- Hono's `/v1/:channel/marketplace.json` route appears to shadow or intercept
  `/v1/marketplace.json` (the bare-seam test in Step 3 would fail). Do not work
  around it by reordering hacks — report it.
- A verification command fails twice after a reasonable fix.

## Maintenance notes

- If a future plan makes **search** (plan 002) channel-aware, it should reuse the
  same `channels` resolver shape rather than inventing a second channel concept.
- The allowlist (`OBJECTCORE_CHANNELS`) prevents arbitrary channel strings from
  creating DB sources. If telemetry later wants per-channel metrics, key them off
  the same allowlist.
- Reviewer should confirm the bare `/v1/marketplace.json` output did not change at
  all — that is the frozen contract Claude Code consumes.
- Deferred out of this plan: documenting the canary publish flow
  (`OBJECTCORE_CHANNEL=canary bun run registry:ingest`) in `release-manager`'s
  skill — a docs follow-up, not code.
