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
- **Registry** — whatever serves `marketplace.json` over a stable URL. Today: Git + CI. Later:
  the Hono backend at `objectcore.ai/v1/marketplace.json`. The URL is permanent; the server swaps.
- **Source / Sink** — the registry-core ports. `CatalogSource` reads plugins (Git now, DB later);
  `CatalogSink` publishes the catalog (file now, HTTP later).
- **The seam** — `deriveCatalog(plugins) -> marketplace.json`, the pure function both the CI job
  and the future backend import. The invariant that makes the backend a relocation, not a rewrite.
- **Trigger surface** — a skill's `name` + `description`: the metadata seen every session that
  decides whether the skill fires. Drafted as a first-class generator output, gated by eval.
