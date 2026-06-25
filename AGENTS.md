# ObjectCore — agent harness config (static context)

ObjectCore is a self-replicating Claude Code plugin marketplace built as a software factory.
Your output is not plugins. It is the system that produces and governs plugins.

## Hard rules (never break)
- **`.claude-plugin/marketplace.json` is NEVER hand-edited.** It is a build artifact of the
  plugin graph. Change a plugin, then run `bun run build:marketplace`.
- **The registry contract is the seam.** All catalog derivation goes through
  `deriveCatalog` in `@objectcore/registry-core`. Do not write a second derivation path.
- **Plugin components live at the plugin root** (`commands/`, `agents/`, `skills/`, `hooks/`),
  never inside `.claude-plugin/` (which holds only `plugin.json`).
- **`repository` is a string; `keywords` is an array; names are kebab-case.** These are hard
  load errors in Claude Code, not style nits.
- **No plugin enters the catalog without passing validation AND its activation eval.**
  A plugin that parses but never activates is worse than one that fails to parse.
- **Before any direct-URL distribution, migrate off relative-path sources** to
  `github`/`git-subdir`/`npm` — relative paths only resolve under Git distribution.
- **Treat every MCP-bundling plugin as a managed credential.** Block publish without provenance.

## Workflow
1. `/forge` (plugin-forge) — spec-driven generation: grill -> plan -> scaffold -> validate.
2. `bun run validate` / `bun run build:marketplace` — re-derive + check the catalog.
3. `bun run eval` — the gate: output evals (offline) + activation evals (per-plugin
   `evals/activation.json`, needs an API key; the cheap-model judge routes trigger surfaces).
4. `bun test` — contract tests for the seam.
5. `bun run registry:dev` — serve the catalog locally (the HTTP adapter as dev loop).
6. Changesets -> release CI. Add `.changeset/<name>.md`; `bun run release:version` bumps
   `plugin.json` + re-derives the catalog (CI opens the Version PR); `bun run release:publish`
   tags `{plugin}--v{semver}`, SHA-pins the catalog (`deriveCatalog`'s `shaPin`), and attests.

`bun run check` runs steps 2–4 together (tsc + catalog validation + tests + evals) — the
single gate `.github/workflows/ci.yml` enforces on every PR. Set the `ANTHROPIC_API_KEY`
secret to enforce the activation half in CI (otherwise it is reported as skipped).

## Model routing
Frontier model authors plugin/skill PROSE (synthesis). Cheap models run validation, lint,
and catalog-sync (the deterministic harvest). Same split as the sleuth pipeline.
