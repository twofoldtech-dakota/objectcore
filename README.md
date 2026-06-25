# ObjectCore

A self-replicating Claude Code plugin marketplace, built as a software factory.
**The output is not plugins — it's the system that produces and governs plugins.**

- Marketplace name: `objectcore` · Registry host (eventual): `objectcore.ai`
- Runtime: Bun + TypeScript · Monorepo: Bun workspaces (+ Turborepo) · Versioning: Changesets

## Architecture (the seam)

The only thing Claude Code consumes is a valid `marketplace.json` at a stable URL. That URL is
the permanent seam; everything behind it is swappable. The invariant is a pure function:

```
deriveCatalog(plugins) -> marketplace.json
```

- **Now (Git era):** CI runs `deriveCatalog` reading `./plugins/*` and writes the file
  (`GitWorkspaceSource` + `GitFileSink`). The Hono app serves it locally as the dev loop.
- **Stage 3 (backend):** the SAME `deriveCatalog` runs in a Hono handler reading the DB and
  serving `objectcore.ai/v1/marketplace.json` (`RegistryDbSource` + HTTP). The contract and the
  route do not change — only the source and sink swap. That is what keeps it from being a rewrite.

The HTTP adapter runs on every dev loop and the same contract tests run on every CI run, so the
backend never rots while it waits for a trigger (search/telemetry, dynamic catalogs, >~50 plugins,
or OIDC publishing).

## Layout

```
.claude-plugin/marketplace.json   # the catalog (BUILD ARTIFACT — never hand-edited)
objectcore.config.json            # marketplace identity (single source)
packages/
  registry-core/                  # @objectcore/registry-core — the pure seam + adapters + validation
  registry-server/                # @objectcore/registry-server — Hono app (dev loop now, prod later)
scripts/build-marketplace.ts      # re-derive + validate + write the catalog
plugins/
  plugin-forge/                   # Stage 1 meta-plugin: the spec-driven generator (skeleton)
  hello-objectcore/               # demo plugin
AGENTS.md / CONTEXT.md            # the factory's harness config + ubiquitous language
```

## Run

```bash
bun install
bun test                 # contract tests for the seam
bun run build:marketplace # derive + validate -> .claude-plugin/marketplace.json
bun run eval             # the eval gate: output evals + activation evals (needs ANTHROPIC_API_KEY)
bun run check            # the full gate CI runs: tsc + catalog validation + tests + evals
bun run registry:dev      # serve http://localhost:8787/v1/marketplace.json
```

Then point Claude Code at the local registry:
`claude --plugin-url http://localhost:8787/v1/marketplace.json`

## Staged plan

- **Stage 0 (this repo):** the seam, validation floor, dev server, example plugins. ✅
- **Stage 1:** the meta-plugins (`plugin-forge` + grilling gate, `marketplace-builder`,
  `plugin-validator`, `meta-generator`); eval harness (output + trajectory evals).
- **Stage 2:** Changesets release CI — write versions, tag `{plugin}--v{semver}`, SHA-pin, SLSA.
- **Stage 3:** operate the backend (flip `RegistryDbSource` + HTTP) at the first trigger.
