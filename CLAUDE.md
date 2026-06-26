# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ObjectCore is a self-replicating Claude Code **plugin marketplace built as a software factory**. The deliverable is not the plugins — it's the system that derives and governs a `marketplace.json` catalog from a graph of plugins. Runtime is **Bun + TypeScript**; it's a Bun-workspace monorepo (Turborepo + Changesets layered on top).

Two companion docs hold authoritative context — read them, they are not optional:
- `AGENTS.md` — hard rules (the invariants below) and the intended workflow.
- `CONTEXT.md` — the ubiquitous language (plugin, meta-plugin, catalog entry, source/sink, the seam, trigger surface). Use these terms exactly.

## Commands

```bash
bun install
bun test                         # contract tests for the seam (bun:test)
bun test packages/registry-core/test/derive.test.ts   # run one test file
bun test -t "is pure"            # run tests matching a name
bun run build:marketplace        # derive + validate -> .claude-plugin/marketplace.json
bun run validate                 # alias of build:marketplace (derive + validate, same script)
bun run eval                     # the eval gate: output evals (offline) + activation evals (needs a key)
bun run forge:scaffold <spec.json> [--force]   # deterministic half of /forge: emit a plugin + re-derive + validate
bun run forge:meta <meta-spec.json> [--force]  # generate a new meta-plugin (governance|generator archetype)
bun run release:status           # Stage 2: preview what the pending changesets would release
bun run release:version          # Stage 2: consume changesets -> bump plugin.json + changelogs + re-derive
bun run release:publish          # Stage 2: tag {plugin}--v{semver}, SHA-pin the catalog, (CI) attest
bun run check:catalog            # read-only: validate every plugin + assert marketplace.json is in sync (no writes)
bun run kb:add --json '<entry>'  # append a knowledge-base entry (lesson|pattern|gotcha|decision) + regenerate INDEX.md
bun run kb:index                 # regenerate knowledge/INDEX.md from knowledge/entries/ (INDEX.md is a build artifact)
bun run kb:check                 # read-only: parse entries + assert INDEX.md is in sync and within budget (part of check)
bun run check                    # the one-command gate = tsc + check:catalog + kb:check + test + eval (what CI runs)
bun run clean:git                # git hygiene: prune stale worktrees + delete merged branches (--dry-run | --gone | --remote)
bun run registry:dev            # serve http://localhost:8787/v1/marketplace.json (Git source, dev loop)
bun run registry:prod           # Stage 3: serve the SHA-pinned catalog from the registry DB (RegistryDbSource); OBJECTCORE_SOURCE=db|file
bun run db:migrate              # Stage 3: apply the registry DB schema (needs DATABASE_URL; no-op otherwise)
bun run registry:ingest [path]  # Stage 3: push dist/marketplace.pinned.json into the registry DB (RegistryDbSink; needs DATABASE_URL)
bunx tsc                         # typecheck (tsconfig is noEmit; there is no separate lint step)
```

Point Claude Code at the local registry: `claude --plugin-url http://localhost:8787/v1/marketplace.json`

## The central architecture: the seam

Everything hinges on one pure function in `@objectcore/registry-core`:

```
deriveCatalog(plugins, opts) -> marketplace.json
```

The only thing Claude Code ever consumes is a valid `marketplace.json` at a stable URL. That URL is the permanent **seam**; everything behind it swaps without changing the contract. This is why the design is structured as **ports + adapters** around `deriveCatalog`:

- **`CatalogSource`** (`sources.ts`) reads plugins. `GitWorkspaceSource` (operated now) reads `./plugins/<name>/.claude-plugin/plugin.json` off disk. `RegistryDbSource` is a deliberate throwing stub that lights up at the Stage 3 backend trigger.
- **`CatalogSink`** (`sinks.ts`) publishes the catalog. `GitFileSink` writes the file (now); `HttpServeSink` holds it in memory for the HTTP server.
- The **same `deriveCatalog`** runs in `scripts/build-marketplace.ts` (CI/dev: Git source → file sink) and in the Hono handler `packages/registry-server/src/app.ts` (`GET /v1/marketplace.json`). The route and contract never change between dev and the eventual production backend — that's what makes Stage 3 a relocation, not a rewrite.

Because the HTTP adapter runs on every dev loop and the contract tests run on every CI run, the backend path never rots while waiting for its trigger.

### The gate (`bun run check` + CI)

The hard rule "no plugin enters the catalog without passing validation AND its activation eval" is enforced by `bun run check` (= `tsc` + `check:catalog` + `test` + `eval`), which is exactly what `.github/workflows/ci.yml` runs on every PR/push. `check:catalog` (`scripts/check-catalog.ts`) is read-only: it re-derives the catalog, runs `validateAll`, and asserts the committed `marketplace.json` *byte-matches* the derivation — so a hand-edit or a forgotten `build:marketplace` fails CI. Activation evals run in CI only when the `ANTHROPIC_API_KEY` secret is set (otherwise reported as skipped, job stays green) — **set that secret to actually enforce the activation half of the gate.**

### The eval harness (`packages/eval` — Stage 1, the gate)

`@objectcore/eval` is the non-deterministic counterpart to `validate.ts`. Validation proves a plugin *loads*; the eval gate proves it's *good* and that its skills actually *fire* — "a skill that never fires is worse than one that fails to parse." Four layers, run by `scripts/eval.ts`:

- **Output evals** (`output.ts`, deterministic, always run): content-quality checks on the derived catalog (description/version/keywords) plus per-plugin `evals/output.json` `expectEntry` assertions (the plugin's intended catalog entry must match what `deriveCatalog` produced).
- **Coverage evals** (`coverage.ts`, deterministic, always run): every skill must have a *positive* activation case targeting it — otherwise it would enter the catalog ungated. `forge` enforces this at generation time; this enforces it for hand-written plugins too. This closes the gap where the activation layer only runs the cases that happen to exist.
- **Readiness evals** (`runReadinessEvals` in `coverage.ts`, deterministic) — the *ship-readiness* half, stricter than structural coverage and run ONLY in the full gate (`scripts/eval.ts`), never the scaffold step (`_finalize.ts`): a skill-bearing plugin must ship a *negative* (`expect:null`) case (the "stays quiet on near-misses" half), and no skill body may still carry the `<!-- forge:todo -->` stub marker (`scaffoldPlugin` emits it for unfilled bodies). A fresh scaffold is a legal stub; a *shippable* plugin must be filled in.
- **Activation evals** (`activation.ts` + `judge.ts`, needs an API key): the gate. A **`Judge`** (ports+adapters, same shape as registry-core's sources/sinks) routes a prompt against the *whole catalog's* skill **trigger surfaces** and we score against `evals/<plugin>/activation.json` cases (`prompt` → expected skill `name`, or `null` for "nothing fires"). `MockJudge` is deterministic/offline (tests, CI without a key); `AnthropicJudge` is the real router. The judge defaults to **`claude-haiku-4-5`** (override `OBJECTCORE_JUDGE_MODEL`) because activation routing is a *classification* task, which AGENTS.md routes to cheap models — not the frontier-model prose tier. Uses structured outputs (no `thinking`/`effort` params, which error on Haiku).

**Conventions:** per-plugin eval specs live at the plugin root under `evals/` (`activation.json`, `output.json`) — an ObjectCore convention, *not* a Claude Code component, so it doesn't violate the components-at-root rule. When a key is absent, activation evals are reported as **skipped**, never silently passed (no silent caps). Trigger surfaces are read from component frontmatter by `trigger-surface.ts`.

### plugin-forge + `@objectcore/forge` (Stage 1, the generator)

`plugin-forge` is the meta-plugin that *produces* plugins; `@objectcore/forge` is its deterministic engine. The split follows the model-routing doctrine: the **grill + plan** phases are prose (frontier synthesis), the **scaffold** is code (cheap/deterministic).

- The plugin (`plugins/plugin-forge/`) ships the `/forge` command and three skills: `specifying` (the grilling gate), `planning` (spec → `PluginSpec`, conforms to `writing-great-skills`), and `writing-great-skills` (the reference spec). The `/forge` pipeline is **grill → plan → scaffold → gate**.
- The engine (`packages/forge/src/scaffold.ts`) takes a **`PluginSpec`** (the output of grill+plan) and emits the plugin dir, components (`skills/`, `commands/`, and — since F2 — `hooks/hooks.json`), and `evals/` specs. It guards the hard rules at write time (kebab-case, components at root, string `repository`, array `keywords`), **refuses to emit a skill without activation cases**, and validates a `hooks` spec (known events, valid action types) — owning the plugin-file `{ "hooks": {...} }` wrapper so the spec carries just the events map. A plugin may be hooks-only (no skill/command). It never overwrites without `force`.
- `scripts/forge-scaffold.ts` (`bun run forge:scaffold`) runs the engine, then re-derives + validates the catalog, writes `marketplace.json`, and runs the offline output evals. `bun run eval` is the activation half of the gate.
- Note: the engine lives in `packages/forge` (testable, reused by CI) rather than bundled inside the distributed plugin — bundling for standalone distribution is a Stage 2/3 packaging step (same "migrate off relative-path sources" caveat in AGENTS.md).

### plugin-validator (Stage 1, governance)

`plugins/plugin-validator/` is the meta-plugin that *governs* correctness: a `/validate` command and a `validating-plugins` skill that document the hard rules + the catalog/coverage/activation invariants and point at `bun run check`/`check:catalog`/`eval`. The enforcement logic itself lives in `registry-core` (`validateAll`) and `@objectcore/eval` (output/coverage/activation) — the plugin is the human/agent-facing reference and runbook over those checks.

### marketplace-builder (Stage 1, governance)

`plugins/marketplace-builder/` governs the catalog *build*: a `/build-marketplace` command and a `building-the-catalog` skill that document the `deriveCatalog` seam, the source/sink ports, the never-hand-edit rule, and the dir↔entry sync invariant. The build logic is `scripts/build-marketplace.ts` over `registry-core`; the plugin is the runbook.

### meta-generator + `metaPluginSpec` (Stage 1, self-replication)

`plugins/meta-generator/` is the meta-plugin that generates *other meta-plugins* — the self-replicating bit. `/new-meta-plugin` + the `meta-plugin-archetypes` skill define two archetypes drawn from the meta-plugins we run: **generator** (grill→plan→scaffold, like plugin-forge) and **governance** (a `/verb` command + reference skill over a rule set, like plugin-validator / marketplace-builder). The engine `metaPluginSpec` (`packages/forge/src/meta.ts`) expands a compact meta-spec into a full, gate-passing `PluginSpec` (tags `meta` + archetype keywords, guarantees the skill has a positive activation case), which `bun run forge:meta` scaffolds. The generated prose is a *skeleton* — refine trigger surfaces, then pass the activation gate.

### release-manager + `@objectcore/release` (Stage 2, the release pipeline)

Stage 2 makes catalog entries **immutable, versioned, and provenanced**. The split is the
same as forge: the deterministic engine lives in `packages/release` (pure: changeset
parsing, semver bumps, release planning, changelog rendering, the provenance predicate),
the `scripts/release-*.ts` CLIs are the disk + git edge, and `release-manager`
(`plugins/release-manager/`, generated by `meta-generator`) is the governance runbook over it.

The flow is `changeset → version → tag {plugin}--v{semver} → SHA-pin → attest`:

- **Changesets.** We adopt the Changesets *file format* (`.changeset/<name>.md`, frontmatter
  of `name: bump`, then a summary) but version **plugins** (`plugin.json`), not npm packages —
  a plugin is a runtime-discovered dir, not a workspace, so the `@changesets` CLI doesn't fit.
  The engine reads the files; `@changesets/config.json` + `.changeset/README.md` document the convention.
- **Version** (`scripts/release-version.ts`, `bun run release:version`): consumes the changesets —
  bumps each plugin's `plugin.json`, keeps its `evals/output.json` `expectEntry.version` in lockstep
  (so the output eval still passes), prepends its `CHANGELOG.md`, deletes the changesets, and
  **re-derives `marketplace.json` through the same `deriveCatalog` seam**. CI opens a Version PR with this.
- **Publish** (`scripts/release-publish.ts`, `bun run release:publish`): tags each plugin
  `{plugin}--v{semver}` (idempotent), then SHA-pins — `deriveCatalog(plugins, { shaPin, repoUrl })`
  rewrites every `source` into an immutable `git-subdir` pin (`url`+`path`+`sha`+`{plugin}--v{semver}` `ref`),
  written to `dist/marketplace.pinned.json`. The committed `marketplace.json` (derived WITHOUT pins) is
  never touched, so `check:catalog` stays byte-exact. **The `shaPin` path in `deriveCatalog` is the
  whole point — pins are a publish-time view of the same pure function, not a second derivation.**
- **Attest.** `.github/workflows/release.yml` pushes the tags and attests the pinned catalog with build
  provenance (`actions/attest-build-provenance`). The **provenance gate**: `release:publish` refuses to
  publish a plugin that bundles MCP (`mcpServers` or an `.mcp.json`) without attestation — an MCP-bundling
  plugin is a managed credential (AGENTS.md).
- **Tag format is single-sourced.** `releaseTag(name, version)` lives in `registry-core` (`tags.ts`)
  because the catalog seam needs it for the pin `ref` and the release engine needs it to create tags —
  one format, never re-spelled.

Stage 2 also added **strict manifest schema validation** (`registry-core/schema.ts`, `validateSchema`,
run inside `validateAll`): a hand-rolled, dependency-free strict check that rejects unknown manifest
fields (a `keyword`/`repositry` typo) and wrong types on every spec field — kept zero-dep to preserve
the pure core, the same reason it hand-rolls its kebab regex.

### registry backend + `@objectcore/registry-db` (Stage 3, the backend)

Stage 3 operates the HTTP backend and flips the catalog source from Git to a DB — by design a
**relocation, not a rewrite**: only the `CatalogSource` (and the deploy target) swap; the
`/v1/marketplace.json` route, its output contract, and `deriveCatalog` never change.

- **The served catalog is the SHA-pinned (git-subdir) form**, not the committed bare-path file —
  bare relative paths only resolve under Git distribution (AGENTS.md). Prod serving is the same
  `shaPin` derivation Stage 2 already produces, sourced from the DB.
- **`createApp` injects the `CatalogSource`** (`packages/registry-server/src/app.ts`) and accepts
  `derive` as opts *or* a resolver — the DB path uses the resolver to attach `shaPin`/`repoUrl`
  from the same rows it serves. `dev.ts` wires `GitWorkspaceSource` (bare-path, local loop);
  `prod.ts` wires `RegistryDbSource` (`OBJECTCORE_SOURCE=db`, the default) or serves a baked
  `dist/marketplace.pinned.json` verbatim (`=file`, break-glass).
- **`RegistryDbSource`/`RegistryDbSink`** are ports in the pure core (`sources.ts`/`sinks.ts`,
  zero new deps) over a `CatalogStore` interface. **Reads swap the source, writes swap the sink:**
  `release:publish` derives the pinned catalog and `registry:ingest` feeds it to `RegistryDbSink`
  (consuming the derivation, so the DB can't diverge); the server reads rows back through
  `RegistryDbSource` and re-runs the same `deriveCatalog`. The DB stores RAW manifests + pin
  coordinates, never finished entries — one derivation path holds.
- **`@objectcore/registry-db`** is the only package that depends on `@libsql/client` (Turso),
  keeping the core dependency-free. It ships `LibSqlCatalogStore`, `InMemoryCatalogStore` (tests /
  no-DB local dev), and the schema (`plugins`, append-only `plugin_versions`, `channels`).
- **Hosting: Fly.io** (`Dockerfile`, `fly.toml`) runs the Bun + Hono entry unchanged; secrets
  `DATABASE_URL` + `TURSO_AUTH_TOKEN`; `objectcore.ai` via `flyctl certs add`. `deploy.yml` deploys
  on merge to main, **inert until `FLY_API_TOKEN` is set**. Release CI runs `registry:ingest` so the
  live backend updates with no redeploy (DB-mode CLIs self-gate on `DATABASE_URL`).
- **Additive routes behind the seam.** Built now: **search** (`GET /v1/search?q=&keyword=&category=`,
  a pure filter over the derived catalog via `searchCatalog` in registry-core) and **channels**
  (`GET /v1/:channel/marketplace.json`, allowlisted via `OBJECTCORE_CHANNELS`, wired in `prod.ts`'s
  `dbApp`). Still designed-but-unbuilt: telemetry (`/v1/events`), OIDC publish (`POST /v1/plugins`,
  re-enforcing the provenance gate). `/v1/marketplace.json` stays frozen.
- **Prod deploy safety.** `prod.ts` runs `store.migrate()` on boot (idempotent) and exposes a
  DB-touching `/readyz` (Fly's health check points at it, not the shallow `/healthz`), so a deploy
  against a fresh/unreachable DB fails the check instead of serving 500s.

### knowledge base + `@objectcore/knowledge` (Stage F1, self-improvement)

The factory's growing memory — the substrate the self-improving loop is built on
(roadmap: `plans/008-foundational-agentic-roadmap.md`, evidence:
`plans/notes/008-agentic-research-findings.md`). It applies the same **storage-is-a-port**
discipline as the catalog: `KnowledgeStore` (`packages/knowledge/src/types.ts`) is
the seam; **`FileKnowledgeStore`** is operated now (git-tracked `knowledge/entries/<id>.md`,
one frontmatter'd file per entry, diffable in PRs so every written lesson is
reviewable). A `DbKnowledgeStore` (Turso, reusing `@objectcore/registry-db`) and an
**MCP resource server** (an *access* seam over a store, the KB's analogue of the
`/v1/marketplace.json` route — folds into the F5 MCP primitive) are later adapters;
nothing above the port changes when they land.

- **`knowledge/INDEX.md` is a build artifact**, like `marketplace.json`: generated
  by `renderIndex` (pure) via `bun run kb:index`, never hand-edited. `bun run kb:check`
  (in `bun run check`) parses every entry and asserts INDEX.md byte-matches a fresh
  render and stays within the **200-line / 25KB** loaded-at-startup budget — overflow
  is the deliberate curate/prune (rot) signal.
- **Entry types**: `lesson | pattern | gotcha | decision`. Zero-dep frontmatter
  parse/serialize (`frontmatter.ts`), keeping the package pure like registry-core.
- **`knowledge-base`** (`plugins/knowledge-base/`, governance meta-plugin) is the
  human/agent runbook: `/remember` + the `curating-knowledge` skill over the store.
- **`kb-writer`** (`plugins/kb-writer/`, F2, hooks-only) is the KB's automated
  read/write *surface*: a `SessionStart` command hook (`hooks/load-kb.ts`) surfaces
  `$CLAUDE_PROJECT_DIR/knowledge/INDEX.md` into context, and a `Stop` prompt hook
  nudges capturing any durable lesson. It is hooks-only on purpose — a skill would
  clash with `curating-knowledge` on activation. The eventual F3 `self-reflection`
  subagent (lesson *generator* from eval failures) writes via the same
  `KnowledgeStore.append`, closing the Reflexion loop on this substrate.

### Repo CLI wiring (`scripts/_workspace.ts`, `scripts/_finalize.ts`)

`scripts/_workspace.ts` (not runnable — underscore prefix) is the single place that turns `objectcore.config.json` + the plugins dir into the `(plugins, catalog)` pair via one `deriveCatalog` call. `build-marketplace`, `check-catalog`, `eval`, `forge-scaffold`, `forge-meta`, and the `release-*` CLIs all import `loadWorkspace`/`loadConfig` from it — so the "single derivation path" holds at the wiring level, not just the function level. `scripts/_finalize.ts`'s `syncAndGate` is the shared post-scaffold tail (re-derive → validate → write → output+coverage evals) used by both forge CLIs. `scripts/_release.ts` is the analogous edge for the release CLIs (changeset reading, the `plugin.json` version edit, git tag/sha/remote helpers, the MCP-bundle scan).

**Identity is single-sourced.** Plugin `author` is not hardcoded — the forge CLIs default a scaffolded plugin's `author` to `objectcore.config.json`'s `owner` (`twofoldtech-dakota`). The four hand-written plugins are aligned to the same value; change identity in one place (the config) and re-derive.

### Module map (`packages/registry-core/src`)
- `types.ts` — domain types mirroring the verified Claude Code plugin/marketplace spec. **Read the doc comments**; they encode spec rules (e.g. `repository` MUST be a string, `keywords` MUST be an array — these are hard load errors in Claude Code, not style).
- `derive.ts` — the pure invariant. No I/O. Sorts entries by name; with `pluginRoot` set, entry `source` is the bare dir name. With `shaPin` + `repoUrl` (publish only) the pinned entry's `source` becomes an immutable `git-subdir` pointer — same pure function, a publish-time view.
- `tags.ts` — the single source of the `{plugin}--v{semver}` release-tag format (`releaseTag`/`parseReleaseTag`). Imported by both `derive.ts` (the pin `ref`) and the release engine (creating tags).
- `validate.ts` — the deterministic validation floor: kebab-case + reserved-name checks (`validateMarketplaceName`), the three hard-load manifest checks (`validateManifests`), the dir↔entry sync invariant (`validateSync`), and component-placement lint (`validatePlacement`). `validateAll` runs them all plus `validateSchema`.
- `schema.ts` — Stage 2 strict manifest schema validation (`validateSchema`): hand-rolled (zero-dep, to keep the core pure) strict shape check that rejects unknown manifest fields and wrong types across every spec field. Runs inside `validateAll`.

## Hard invariants (breaking these breaks the factory)

1. **`.claude-plugin/marketplace.json` is NEVER hand-edited.** It is a build artifact. Change a plugin, then run `bun run build:marketplace`. (`turbo.json` declares it as a build output.)
2. **All catalog derivation goes through `deriveCatalog`.** Never write a second derivation path.
3. **Plugin components live at the plugin root** (`commands/`, `agents/`, `skills/`, `hooks/`), never inside `.claude-plugin/` (which holds only `plugin.json`). `validatePlacement` enforces this.
4. **`repository` is a string; `keywords` is an array; all names are kebab-case.** Enforced in `validate.ts`; covered by `derive.test.ts`.
5. **No plugin enters the catalog without passing validation AND its activation eval.** A plugin that parses but never activates is worse than one that fails to parse.
6. The marketplace `name` (`objectcore`) must avoid Anthropic's reserved list (see `RESERVED_MARKETPLACE_NAMES` in `validate.ts`).

## Layout notes
- `objectcore.config.json` is the single source of marketplace identity (`name`, `owner`, `pluginRoot`, schema/registry URLs); both `build-marketplace.ts` and `dev.ts` read it.
- `packages/*` are the only npm workspaces. `plugins/*` are **not** workspaces — they are discovered at runtime by `GitWorkspaceSource`.
- `plugins/plugin-forge/` is the Stage 1 meta-plugin (the spec-driven generator: grill → plan → scaffold → validate, via `/forge`); currently a skeleton. `plugins/hello-objectcore/` is the end-to-end demo plugin.
- The `OC/` directory holds a packaged snapshot (zip + readme + marketplace.json), not the working source.

## Staging
**Stage 0** (the seam, validation floor, dev server, example plugins), **Stage 1** (the meta-plugins + eval harness gate), and **Stage 2** (Changesets release CI — `release-manager` + `@objectcore/release`: version, tag `{plugin}--v{semver}`, SHA-pin via `deriveCatalog`'s `shaPin` opt, attest; plus strict manifest schema validation) are **built**. **Stage 3** (built) = the HTTP backend operates and the catalog source flips Git → DB: `@objectcore/registry-db` (Turso/libSQL `CatalogStore`), `RegistryDbSource`/`RegistryDbSink`, `prod.ts`, ingestion in release CI, and Fly.io deploy (`Dockerfile`/`fly.toml`/`deploy.yml`). **Search and channels are now built** (additive routes behind the frozen seam — see the registry-backend section + `/readyz` deploy safety); telemetry (`/v1/events`) and OIDC publish (`POST /v1/plugins`) remain designed-but-unbuilt. The forge pipeline was also hardened: pre-write activation↔skill cross-validation + an unfilled-body stub marker (`scaffold.ts`), a ship-readiness eval layer (`runReadinessEvals`), and an updated `plugin-forge` prose set. The `ANTHROPIC_API_KEY`/`FLY_API_TOKEN`/`DATABASE_URL`/`TURSO_AUTH_TOKEN` secrets are set and the backend is **deployed and live on Fly**, serving the SHA-pinned catalog from Turso at `https://objectcore-registry.fly.dev/v1/marketplace.json` (CI enforces the activation gate; merges to main deploy + run the release pipeline). The only deferred operator item is the `objectcore.ai` custom domain (DNS/TLS) — **running on the `*.fly.dev` URL for now**. When extending, keep new work behind the existing ports rather than adding new paths.
