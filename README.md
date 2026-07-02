# ObjectCore

A self-replicating Claude Code plugin marketplace, built as a software factory.
**The output is not plugins — it's the system that produces and governs plugins.**

- Marketplace name: `objectcore` · Live registry: `https://registry.objectcore.ai/v1/marketplace.json`
- Runtime: Bun + TypeScript · Monorepo: Bun workspaces · Versioning: Changesets

## Architecture (the seam)

The only thing Claude Code consumes is a valid `marketplace.json` at a stable URL. That URL is
the permanent seam; everything behind it is swappable. The invariant is a pure function:

```
deriveCatalog(plugins, opts) -> marketplace.json
```

- **Git path (dev + CI):** `deriveCatalog` reads `./plugins/*` and writes the committed file
  (`GitWorkspaceSource` + `GitFileSink`). `bun run registry:dev` serves it locally as the dev loop.
- **Backend (live):** the SAME `deriveCatalog` runs in a Hono handler reading the registry DB
  (Turso/libSQL on Fly.io) and serving the SHA-pinned catalog at
  `https://registry.objectcore.ai/v1/marketplace.json` (`RegistryDbSource`). The route and the
  contract did not change when the source flipped Git → DB — a relocation, not a rewrite.

Additive routes live behind the frozen seam: search (`GET /v1/search`), channels
(`GET /v1/:channel/marketplace.json`), telemetry (`POST /v1/events`), and OIDC publish
(`POST /v1/plugins` — the single release-CI publish path; direct DB ingest is manual break-glass).

## Layout

```
.claude-plugin/marketplace.json   # the catalog (BUILD ARTIFACT — never hand-edited)
objectcore.config.json            # marketplace identity (single source)
packages/                         # the npm workspaces (all pure cores are zero-dep)
  registry-core/                  # the seam: deriveCatalog + source/sink ports + validation
  registry-server/                # Hono app: /v1/marketplace.json + search/channels/events/publish
  registry-db/                    # Turso/libSQL CatalogStore (the only package with a DB dep)
  eval/                           # the gate: output/coverage/readiness (offline) + activation/delegation (judged)
  forge/                          # deterministic scaffold engine behind /forge (PluginSpec -> plugin dir)
  release/                        # release engine: changesets, semver bumps, changelogs, provenance
  knowledge/                      # the factory KB: KnowledgeStore port + FileKnowledgeStore
  design/                         # design-system engine: DTCG tokens -> deriveDesignSystem -> sinks
plugins/                          # 13 plugins, runtime-discovered (NOT workspaces): the meta-plugins
                                  # (plugin-forge, plugin-validator, marketplace-builder,
                                  # meta-generator, release-manager, design-forge, ...), the
                                  # self-improvement loop (knowledge-base, kb-writer, reflection,
                                  # forge-improver), and demos
knowledge/                        # KB entries + INDEX.md (build artifact, budget-checked)
design/                           # the dogfooded design-token SSOT
scripts/                          # the CLI edge over the pure packages
AGENTS.md / CONTEXT.md            # the factory's harness config + ubiquitous language
```

## Run

```bash
bun install
bun run check             # the full gate CI runs: tsc + check:catalog + kb:check + design:check + tests + evals
bun test                  # contract tests for the seam
bun run build:marketplace # derive + validate -> .claude-plugin/marketplace.json
bun run eval              # output/coverage/readiness evals offline; activation/delegation need ANTHROPIC_API_KEY
bun run registry:dev      # serve http://localhost:8787/v1/marketplace.json
```

Point Claude Code at the live registry:

```
claude --plugin-url https://registry.objectcore.ai/v1/marketplace.json
```

(or at the local dev loop: `claude --plugin-url http://localhost:8787/v1/marketplace.json`)

## Stages (all built)

- **Stage 0 — the seam:** `deriveCatalog`, the validation floor, the dev server, example plugins. ✅
- **Stage 1 — meta-plugins + the gate:** `plugin-forge` (grill → plan → scaffold → gate),
  `plugin-validator`, `marketplace-builder`, `meta-generator`; the eval harness
  (output/coverage/readiness offline, activation/delegation judged). ✅
- **Stage 2 — release pipeline:** changeset → version → tag `{plugin}--v{semver}` → SHA-pin
  (`deriveCatalog`'s `shaPin` opt) → attest (SLSA provenance); strict manifest schema validation. ✅
- **Stage 3 — the backend:** Fly.io + Turso, catalog source flipped Git → DB, OIDC publish as the
  single release path, live at `registry.objectcore.ai`. ✅

Beyond the stages: the self-improving loop (knowledge base, `kb-writer`/`reflection` hooks,
gate-health trend — plans 008/009) and the design-system pipeline (plan 012).

Detail lives in `CLAUDE.md` (commands + architecture) and `AGENTS.md` (hard rules).
