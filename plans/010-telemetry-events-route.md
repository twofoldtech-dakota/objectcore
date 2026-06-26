# Plan 010: telemetry `/v1/events` — the first registry write path

> **What this is**: build the first half of the deferred **D4** item (telemetry +
> OIDC publish) — the additive `POST /v1/events` ingestion route — now that the
> backend is deployed and live on Fly (the "most valuable after a deployed host with
> traffic" precondition is met). **OIDC publish (`POST /v1/plugins`) stays deferred**
> and gets its own plan; this iteration is telemetry only (one gated item).
>
> **Drift check (run first)**: `bun run check` green + `git status` clean. If
> `packages/registry-server/src/app.ts`, `registry-core/src/`, or `registry-db/src/`
> changed shape since this was written (branch `feat/telemetry-events`), re-read them.

## Status

- **Priority**: P2 (capability growth behind the frozen seam; not on the F-roadmap critical path).
- **Effort**: S–M (one pure-core module, two adapters, one route, wiring, tests).
- **Risk**: LOW. The route is *additive* and *append-only*; it never touches
  `deriveCatalog` or `/v1/marketplace.json`, and it is absent unless a sink is injected.
- **Depends on**: Stage 3 backend (built + deployed). No new deps.
- **Built on**: branch `feat/telemetry-events`.

## Design — storage-is-a-port, again

The same discipline as the catalog (`CatalogStore`) and the KB (`KnowledgeStore`):
a port in the dependency-free core, concrete adapters in `@objectcore/registry-db`,
a thin HTTP adapter over a pure validator.

- **Port + pure validator** (`packages/registry-core/src/events.ts`):
  - `EventSink` — the write port (`record` + `recent`/`count` for tests and a future
    authenticated stats route).
  - `TelemetryEvent` / `StoredEvent` — the domain types (`type` from an allowlisted
    `EVENT_TYPES`, optional kebab `plugin`/`channel`, a bounded primitive `meta` bag;
    `at` is server-assigned on `StoredEvent`, never client-set).
  - `parseEvent(input): EventParseResult` — strict, pure, never-throws shaping of an
    untrusted body. Rejects unknown fields / types / non-kebab ids / oversized meta,
    the same reject-unknown stance as `schema.ts` (no silent drops). No `Date.now`
    (purity, like `deriveCatalog`).
- **Adapters** (`packages/registry-db/src/events.ts` + a separate `EVENTS_SCHEMA_SQL`
  in `schema.ts`): `LibSqlEventStore` (Turso; the only place `@libsql/client` lives)
  and `InMemoryEventStore` (tests / no-DB; injectable clock). A *separate* table +
  store from the catalog — events are an unrelated concern; both `migrate()`s are
  idempotent and run on boot.
- **Route** (`packages/registry-server/src/app.ts`): `POST /v1/events`, registered
  **only when `opts.events` is injected** (absent otherwise, exactly like `channels`).
  parse → 400 on bad body, 401 on bad token, **202** on accept. The marketplace seam
  is untouched.
- **Auth — inert until armed**: `opts.eventsToken` (from `OBJECTCORE_EVENTS_TOKEN` in
  `prod.ts`). Unset ⇒ open ingestion; set ⇒ require `Authorization: Bearer <token>`.
  Same posture as `deploy.yml` / `record-history.yml`.
- **Wiring** (`prod.ts` `dbApp`): a second `LibSqlEventStore.fromEnv()` against the
  same DB, migrated on boot, injected as `events` with the env token. The `file`
  break-glass app is unchanged (verbatim serve).

## What this iteration deliberately does NOT build

- **No public read route.** Ingestion only. The port's `recent`/`count` back tests
  and a *future authenticated* `GET /v1/events/stats` — an unauthenticated telemetry
  read would be a data-exposure surface, so it waits for the auth story.
- **No rate limiting / abuse controls** beyond the optional shared secret + the
  meta-size bounds. Note for a follow-up if traffic warrants.
- **OIDC publish** (`POST /v1/plugins`) — its own plan.

## Done criteria

- [x] `EventSink` port + `parseEvent` in registry-core; exported from its index.
- [x] `LibSqlEventStore` + `InMemoryEventStore` + `EVENTS_SCHEMA_SQL`; exported from registry-db.
- [x] `POST /v1/events` in `createApp` (sink-gated, token-gated, 202/400/401/404); wired in `prod.ts`.
- [x] Tests: pure validator (registry-core), store round-trip (registry-db), route + token + absent-sink (registry-server).
- [x] `bun run check` green; `marketplace.json` byte-unchanged (no derivation touched).
- [ ] Reviewed + merged (the checkpoint).

## Follow-ups (not this plan)

- OIDC publish `POST /v1/plugins` (the D4 other half) — auth + provenance-gate re-enforcement + `RegistryDbSink`.
- Authenticated `GET /v1/events/stats` once the read-auth story is decided.
- Per-channel telemetry keying (noted in plan 001's maintenance notes).
