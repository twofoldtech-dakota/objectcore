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
bun run check                    # the one-command gate = tsc + check:catalog + test + eval (what CI runs)
bun run registry:dev            # serve http://localhost:8787/v1/marketplace.json
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

`@objectcore/eval` is the non-deterministic counterpart to `validate.ts`. Validation proves a plugin *loads*; the eval gate proves it's *good* and that its skills actually *fire* — "a skill that never fires is worse than one that fails to parse." Three layers, run by `scripts/eval.ts`:

- **Output evals** (`output.ts`, deterministic, always run): content-quality checks on the derived catalog (description/version/keywords) plus per-plugin `evals/output.json` `expectEntry` assertions (the plugin's intended catalog entry must match what `deriveCatalog` produced).
- **Coverage evals** (`coverage.ts`, deterministic, always run): every skill must have a *positive* activation case targeting it — otherwise it would enter the catalog ungated. `forge` enforces this at generation time; this enforces it for hand-written plugins too. This closes the gap where the activation layer only runs the cases that happen to exist.
- **Activation evals** (`activation.ts` + `judge.ts`, needs an API key): the gate. A **`Judge`** (ports+adapters, same shape as registry-core's sources/sinks) routes a prompt against the *whole catalog's* skill **trigger surfaces** and we score against `evals/<plugin>/activation.json` cases (`prompt` → expected skill `name`, or `null` for "nothing fires"). `MockJudge` is deterministic/offline (tests, CI without a key); `AnthropicJudge` is the real router. The judge defaults to **`claude-haiku-4-5`** (override `OBJECTCORE_JUDGE_MODEL`) because activation routing is a *classification* task, which AGENTS.md routes to cheap models — not the frontier-model prose tier. Uses structured outputs (no `thinking`/`effort` params, which error on Haiku).

**Conventions:** per-plugin eval specs live at the plugin root under `evals/` (`activation.json`, `output.json`) — an ObjectCore convention, *not* a Claude Code component, so it doesn't violate the components-at-root rule. When a key is absent, activation evals are reported as **skipped**, never silently passed (no silent caps). Trigger surfaces are read from component frontmatter by `trigger-surface.ts`.

### plugin-forge + `@objectcore/forge` (Stage 1, the generator)

`plugin-forge` is the meta-plugin that *produces* plugins; `@objectcore/forge` is its deterministic engine. The split follows the model-routing doctrine: the **grill + plan** phases are prose (frontier synthesis), the **scaffold** is code (cheap/deterministic).

- The plugin (`plugins/plugin-forge/`) ships the `/forge` command and three skills: `specifying` (the grilling gate), `planning` (spec → `PluginSpec`, conforms to `writing-great-skills`), and `writing-great-skills` (the reference spec). The `/forge` pipeline is **grill → plan → scaffold → gate**.
- The engine (`packages/forge/src/scaffold.ts`) takes a **`PluginSpec`** (the output of grill+plan) and emits the plugin dir, components, and `evals/` specs. It guards the hard rules at write time (kebab-case, components at root, string `repository`, array `keywords`) and **refuses to emit a skill without activation cases** — so every generated plugin is gated by construction. It never overwrites without `force`.
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
**Stage 0** (the seam, validation floor, dev server, example plugins), **Stage 1** (the meta-plugins + eval harness gate), and **Stage 2** (Changesets release CI — `release-manager` + `@objectcore/release`: version, tag `{plugin}--v{semver}`, SHA-pin via `deriveCatalog`'s `shaPin` opt, attest; plus strict manifest schema validation) are **built**. **Stage 3** (pending) = flip `RegistryDbSource` + HTTP backend at the first real trigger (search/telemetry, dynamic catalogs, >~50 plugins, or OIDC publishing). When extending, keep new work behind the existing ports rather than adding new paths.
