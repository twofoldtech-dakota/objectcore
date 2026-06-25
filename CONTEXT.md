# ObjectCore — ubiquitous language

Single definitions so every generator and human speaks one vocabulary.

- **Plugin** — a Claude Code plugin: a directory with `.claude-plugin/plugin.json` and
  components (`commands/`, `agents/`, `skills/`, `hooks/`, MCP/LSP config) at its root.
- **Meta-plugin** — a plugin whose job is to produce or govern other plugins
  (e.g. `plugin-forge`). Meta-plugins are first-class catalog entries.
- **Catalog entry** — one element of `marketplace.json`'s `plugins[]`: a `{ name, source, ... }`
  pointer to a plugin. Derived, never authored by hand.
- **Marketplace** — `.claude-plugin/marketplace.json`: the catalog Claude Code consumes via
  `/plugin marketplace add`. Its `name` is `objectcore` and must avoid Anthropic's reserved list.
- **Channel** — a release track (e.g. stable vs canary), realized as a branch or a second
  marketplace.
- **Changeset** — a `.changeset/<name>.md` file declaring intent: which plugins bump and by
  how much (`major`/`minor`/`patch`), plus the changelog summary. The unit of a release.
- **Release** — consuming changesets to bump plugin versions, tag each `{plugin}--v{semver}`,
  and publish a SHA-pinned catalog. Derived from changesets, never hand-edited (like the catalog).
- **SHA-pin** — a publish-time catalog entry whose `source` is an immutable `git-subdir`
  pointer (`url`+`path`+`sha`+`ref`) instead of a bare path. Same `deriveCatalog`, with `shaPin`.
- **Provenance** — a build attestation for a published artifact. A plugin that bundles an MCP
  server is a managed credential and must not publish without it.
- **Registry** — whatever serves `marketplace.json` over a stable URL. The URL is permanent
  (`objectcore.ai/v1/marketplace.json`); the server swaps. Dev loop: Git + the Hono app. Stage 3:
  the same Hono app on Fly.io reading the registry DB. It always serves the SHA-pinned form.
- **Source / Sink** — the registry-core ports. `CatalogSource` reads plugins (`GitWorkspaceSource`
  off disk; `RegistryDbSource` from the DB at Stage 3); `CatalogSink` publishes the catalog
  (`GitFileSink` writes the file; `HttpServeSink` serves it; `RegistryDbSink` ingests the pinned
  catalog into the DB). Reads swap the source; writes swap the sink.
- **Registry DB** — the Stage 3 store behind `RegistryDbSource`/`RegistryDbSink` (Turso/libSQL via
  `@objectcore/registry-db`). Stores RAW manifests + pin coordinates (`relDir`/`sha`/`ref`/`repoUrl`)
  in append-only `plugin_versions`, with a `channels` table pointing each plugin to its current
  version. It is a source of plugin *rows*, never of finished entries — `deriveCatalog` still shapes
  them at read time.
- **The seam** — `deriveCatalog(plugins) -> marketplace.json`, the pure function both the CI job
  and the backend import. The invariant that makes the backend a relocation, not a rewrite.
- **Trigger surface** — a skill's `name` + `description`: the metadata seen every session that
  decides whether the skill fires. Drafted as a first-class generator output, gated by eval.
