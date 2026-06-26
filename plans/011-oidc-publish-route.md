# Plan 011: OIDC publish `POST /v1/plugins` — self-service publishing over HTTP

> **What this is**: the second half of deferred **D4** — the HTTP analogue of the
> Stage 2 release pipeline. A publisher (GitHub Actions, holding an OIDC token) POSTs
> a plugin version; the server verifies the token, authorizes it against a policy,
> **re-enforces the provenance gate**, and writes through the `CatalogStore` port.
> Built in the same PR as plan 010 (telemetry).
>
> **Drift check (run first)**: `bun run check` green + `git status` clean.

## Status

- **Priority**: P2 (capability growth behind the frozen seam).
- **Effort**: M (the heaviest write path — real OIDC verification).
- **Risk**: MEDIUM. It mutates the served catalog and verifies untrusted tokens.
  Mitigated by: ports + adapters (fully gate-tested with `MockOidcVerifier`), a
  fail-closed verifier, the re-enforced provenance gate, and **inert-until-armed**
  wiring (the route is absent unless `OBJECTCORE_OIDC_AUDIENCE` is configured).
- **Depends on**: Stage 3 backend + the Stage 2 provenance gate (`requiresProvenance`).
- **Built on**: branch `feat/telemetry-events`.

## Design — ports + adapters, like the catalog and the Judge

The same split as `deriveCatalog`'s sources/sinks and the eval `Judge`:

- **`OidcVerifier` port** (`packages/registry-core/src/publish.ts`):
  - `MockOidcVerifier` — deterministic, offline (gate tests / CI). Maps tokens → claims.
  - `GitHubOidcVerifier` — the live path: validates a GitHub Actions OIDC **JWT (RS256)**
    against the issuer's **JWKS** via **Web Crypto** (no JWT dependency — registry-core
    stays dep-free, the same posture as the hand-rolled schema check). Fails CLOSED on
    any malformed token / unknown kid / bad signature / wrong alg (`none`/HS* rejected)
    / expiry. Network path, so wired in prod but **not unit-tested** (like `AnthropicJudge`).
- **`authorizePublish(claims, policy)`** (pure): rejects a wrong issuer/audience and a
  `repository` claim that isn't allowlisted; **rejects an absent repository claim**
  (fail closed). Policy is `{ issuer, audience, allowedRepositories }`.
- **`parsePublish(input)`** (pure, strict, never-throws): validates the body, **reuses
  the catalog's `validateSchema`** so a published manifest faces the SAME strict floor
  as a Git-sourced one (unknown fields / wrong types rejected). The `ref` is
  **recomputed server-side** via `releaseTag(name, version)` — never trusted from the
  client. `bundlesMcp` lets the publisher declare a root `.mcp.json` the server can't see.
- **The route** (`createApp`, `POST /v1/plugins`, sink-gated like channels/events):
  verify → authorize → parse → **provenance gate** → write. Status: `401` (bad/missing
  token), `403` (policy), `400` (bad body), `422` (MCP bundle without attestation),
  `201` (published). Writes via the `CatalogStore` port (`upsertVersion` + `setChannel`)
  — the same port `RegistryDbSink` uses, so reads re-derive identically (one derivation
  path). **This finally populates the long-unused `provenance` column** (the C2 finding).
- **Provenance gate single-sourced**: the route imports `requiresProvenance` from
  `@objectcore/release` (the Stage 2 predicate), OR'd with `bundlesMcp`. One rule, two
  enforcement points (git-publish + HTTP-publish) — by design.
- **Wiring** (`prod.ts`): inert until `OBJECTCORE_OIDC_AUDIENCE` is set. Then
  `GitHubOidcVerifier` + a policy from `OBJECTCORE_OIDC_ISSUER` (default GitHub Actions)
  + `OBJECTCORE_PUBLISH_REPOS`. The release-CI git path (`registry:ingest`) still works
  regardless — this is an *additional* publish channel, not a replacement.

## What this deliberately does NOT do

- **No self-merge of the catalog's source of truth.** Publishing writes to the DB
  channel the server serves; the Git-tracked `marketplace.json` is unchanged (it is the
  bare-path dev artifact, not the served pinned catalog — AGENTS.md).
- **The live `GitHubOidcVerifier` is not gate-tested** (network + real crypto), exactly
  like `AnthropicJudge`. The pure authz/parse/gate logic IS fully tested with the mock.
- **No revocation / yank route** yet — append-only publish only.

## Done criteria

- [x] `OidcVerifier` port + `Mock`/`GitHub` adapters + `authorizePublish` + `parsePublish` + `toStoredPlugin` (registry-core).
- [x] `POST /v1/plugins` in `createApp` (verify → authz → parse → provenance → write); wired inert in `prod.ts`.
- [x] Tests: authz + parse (registry-core), route 201/401/403/400/422/404 + provenance gate (registry-server, `MockOidcVerifier` + `InMemoryCatalogStore`).
- [x] `bun run check` green; `marketplace.json` byte-unchanged.
- [ ] Reviewed + merged (the checkpoint).

## Publisher side — BUILT (the dogfood)

`scripts/registry-publish.ts` (`bun run registry:publish`) is the HTTP counterpart of
`registry:ingest`: it reconstructs each `PublishRequest` from the workspace (raw manifest
+ relDir + release-commit sha + repoUrl + an MCP-bundle scan, like `release:publish`),
**mints a GitHub Actions OIDC token scoped to `OBJECTCORE_OIDC_AUDIENCE`** (via the
`ACTIONS_ID_TOKEN_REQUEST_*` env, or `OBJECTCORE_OIDC_TOKEN` for local testing), and POSTs
each to `${OBJECTCORE_REGISTRY_URL}/v1/plugins`. It **self-gates green** (the
`registry:ingest` posture): a no-op unless `OBJECTCORE_REGISTRY_URL` + an OIDC token are
present. `--dry-run` prints the plan without minting/posting. `release.yml` runs it after
attestation, **inert until the repo variable `OBJECTCORE_REGISTRY_URL` is set** — the
credential-free alternative to (or, idempotently, alongside) the direct DB ingest. When
attested it attaches a provenance reference (incl. the `attestation-url`) so MCP-bundling
plugins clear the route's provenance gate.

## Follow-ups (not this plan)

- Verify the attestation bundle server-side (the route currently *stores* the provenance reference; it does not validate it).
- A yank/deprecate route once immutability needs an escape hatch.
- Rate limiting / per-repo quotas if abused.
