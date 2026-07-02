---
name: building-the-catalog
description: Reference for how the ObjectCore marketplace catalog is derived — the deriveCatalog seam, the source/sink ports, and the sync invariant. Use when changing how marketplace.json is produced, when marketplace.json is stale, drifted, or out of sync with the plugin dirs, or when reasoning about the Git/DB source swap. (A plugin failing the manifest rules is validating-plugins' territory.)
---
# Building the catalog (the seam)

The only thing Claude Code consumes is a valid `marketplace.json` at a stable URL. Everything behind that URL is swappable; the invariant is one pure function:

```
deriveCatalog(plugins) -> marketplace.json
```

## Ports + adapters
- **Source** (`CatalogSource`) reads plugins. `GitWorkspaceSource` reads `./plugins/<name>/.claude-plugin/plugin.json` (the repo/dev loop); `RegistryDbSource` reads the registry DB (the live backend). Same contract — reads swap the source.
- **Sink** (`CatalogSink`) publishes. `GitFileSink` writes the committed file; the Hono app serves the same derivation over HTTP (dev loop and prod alike).
- The **same `deriveCatalog`** runs in `scripts/build-marketplace.ts` and in the server handler. That is what made the backend a relocation, not a rewrite — never write a second derivation path.

## What derivation does
- Sorts entries by name (deterministic output for the same input).
- Copies catalog-relevant manifest fields (`description`, `version`, `keywords`, …) into each entry.
- With `pluginRoot` set, the entry `source` is the bare dir name and `metadata.pluginRoot` is recorded.

## Invariants the build enforces
- **`marketplace.json` is never hand-edited** — it is a pure function of the graph; re-derive instead.
- **Dir ↔ entry is one-to-one** — every plugin has exactly one entry and vice-versa (no stale, duplicate, or orphan).
- **Marketplace `name`** is kebab-case and not on Anthropic's reserved list.

## Channels
A *channel* is a release track (e.g. stable vs canary), served at `GET /v1/:channel/marketplace.json` (allowlisted via `OBJECTCORE_CHANNELS`). It is still the same `deriveCatalog` over a different plugin set — not a new derivation path.
