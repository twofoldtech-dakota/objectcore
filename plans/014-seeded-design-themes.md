# Plan 014 — Seeded themes, widened role contract, and generated spec pages

> **Status: BUILT** (feature branch `feat/014-seeded-design-themes`, 2026-07-02). Executed as an
> agent DAG: foundation → 4 parallel worktree lanes (presets+CLI, spec sink, scaffold widening,
> plugin prose), each adversarially reviewed clean, then integrated. POC inputs (read-only):
> `D:\github\design-system-poc`.

## Context

Plan 012's design system could *generate* a system from a brief (`scaffoldDesignSystem`), but every
system started from scratch and the semantic vocabulary was narrow (`bg.canvas/subtle/surface`,
`text.primary/subtle`, `accent.solid/text`). The maintainer's POC contained two complete, curated
theme systems strictly richer than anything the engine could express or gate:

- **inkwell** — quiet/editorial/warm paper: 5 hex ramps (57 values; neutral has 150/850
  half-steps), 6 themes (`paper` light default, `ink` dark, + wardrobe
  `study/kiln/arboretum/nocturne`), WCAG AAA text pairings, `border.input` ≥3:1 (WCAG 1.4.11),
  `$extensions["ai.objectcore.derived"].source` provenance on primitives.
- **cathode** — loud/technical/emissive (inkwell's opposite): 5 ramps
  (graphite/volt/pulse/flare/klaxon), 9 themes (`glass` dark default, `daylight`, + channels
  `terminal/blueprint/ledger/manila/litmus/sonar/redline`).
- Both share **one semantic role contract**: `bg.base/surface/raised`, `border.subtle/strong/input`,
  `text.emphasis/primary/secondary/muted/disabled`, `accent.default/hover/subtle-bg/on-accent/
  focus-ring`, `status.{success,warning,danger}-{bg,text}`, `solid.*`.
- Each POC system shipped an **interactive spec HTML** (theme switcher, click-to-copy ramps, role
  docs, a *measured* contrast-proof table, adoption steps).

**Goal:** the CLI offers two paths converging on the same seam (`deriveDesignSystem`), gate, and
sinks — full creation (grill → `design:scaffold`) and **quick start** (`design:seed <preset>`,
optional `--themes` subset → instant gate-passing `design/<name>/`). Plus a **SpecHtmlSink**: every
system gets a generated specimen page whose proof table comes from the same gate math.

## Decisions (settled with the maintainer, 2026-07-02)

1. **`design/objectcore` migrated now** to the widened contract (re-scaffolded from its
   `brief.json`; dist CSS var renames `--bg-canvas`→`--bg-base` etc. accepted). The standing gate
   went from 18 legacy pairs to 58 contract pairs.
2. **Cathode patched to full AAA** rather than carving AA exceptions into the contract. The POC's
   claims were recomputed with the repo's own `contrastRatio`; 14 failing pairs were fixed by 15
   alias re-points (one step deeper on the same ramp, ZERO hex edits), every deviation recorded
   with before/after ratios in each `preset.json` `"source"` note. Result: the contract table has
   NO per-pair AA policy exceptions. `border.input` gates 3:1 vs `bg.base`+`bg.surface` only
   (documented exclusion — inputs don't sit on raised surfaces).
3. **Full POC parity** for the generated spec page (hero, principles via per-preset
   `spec-copy.json`, ramps with provenance dots, roles, side-by-side parity specimen, rooms
   gallery, proof table, adoption).
4. **No committed seeded demo** under `design/` — `presets.test.ts` proves both presets end-to-end;
   committed systems would add judged-eval cost to every keyed CI run.

Settled defaults: new verb **`design:seed`** (house precedent: two entry verbs over one shared
tail); quick-start is a fork **inside `/design`** (commands aren't judge-routed — a second command
buys no activation clarity); design-forge keywords gain `"themes"`; presets are checked-in
engine-native DTCG under `packages/design/presets/` (one-time conversion, never a load-time
converter).

## What landed where

- **`packages/design/src/roles.ts`** — the semantic role contract: `GateLevel`, `CONTRACT_PAIRS` /
  `LEGACY_PAIRS` / `EXEMPT_PAIRS` / `REQUIRED_ROLES`, presence-gated `contractPairs`,
  `checkContractCoverage`.
- **`packages/design/src/proof.ts`** — `ProofEntry` + `proveContrast` (THE single contrast-math
  source; deterministic; uncomputable color ⇒ warning, never a silent pass) and
  `checkContractContrast` (failing proof entries mapped to issues — gate ≡ proof).
- **`packages/design/src/presets.ts` + `packages/design/presets/{inkwell,cathode}/`** —
  `listPresets`/`getPreset`/`instantiatePreset(preset, {name?, themes?}) -> ScaffoldResult` (pure,
  issues-not-throws, default theme ordered first for the `:root` emit, manifest
  `{gate:{level,coverage:"full"}, seed:{...}}`, self-gates at the preset's level). Preset dirs:
  `preset.json` (roster/appearances/brief/eval cases/source note), `primitives.tokens.json`
  ($extensions verbatim), `semantic-shared.tokens.json` (solid.*), one `semantic-<theme>.tokens.json`
  per theme, `spec-copy.json` (editorial voice for the spec page).
- **`packages/design/src/spec.ts`** — pure `renderSpecHtml` (small section builders; page chrome
  consumes the system's own vars with fallback chains so wide AND legacy narrow contracts render;
  data embedded as one escaped JSON island; byte-deterministic) + `SpecHtmlSink` +
  `extractRamps`/`extractRoles`/`specProvenance`.
- **`packages/design/src/sources.ts`** — `SystemManifest` + `loadSystemManifest`
  (`design/<name>/system.json`; ENOENT → AA/presence defaults; malformed → loud).
- **`packages/design/src/sinks.ts`** — exported `colorToCss` + `themeDecls`; new `ProofSink`
  (`dist/contrast-proof.json`).
- **`packages/design/src/scaffold.ts`** — `semantic()` widened to the full contract (dual-constraint
  accent solve, `border.input` 3:1 solve, status/solid from success/warning/danger families; no
  legacy role names — clean break); `ScaffoldResult.manifest`.
- **`scripts/_design.ts`** — `writeSystemAndGate`, the shared write→derive-views→self-gate tail
  (design analogue of `_finalize.ts`), used by `design-scaffold.ts` + `design-seed.ts`.
- **`scripts/design-seed.ts`** — `bun run design:seed --list | <preset> [--name <s>]
  [--themes a,b,c] [--out <dir>] [--force]`; exit 0/1/2; `--list` renders from `listPresets()`;
  copies the preset's `spec-copy.json` into the seeded dir.
- **`scripts/design-check.ts`** — gates each system via `loadSystemManifest` →
  `checkContractContrast(out, {level, includeLegacy:true})` (+ coverage when `"full"`).
- **`scripts/design-build.ts`** — per system also computes `proveContrast` + `specProvenance` and
  emits `SpecHtmlSink` + `ProofSink` (8 dist files for objectcore).
- **`plugins/design-forge`** — `/design` gains the phase-0 quick-start↔grill fork + "Where this
  runs" honesty note; new `choosing-a-seeded-theme` skill (preset inventory + the ≥2-adjectives
  decision rule); `defining-design-tokens` description points quick-starters at it; 4 new
  activation cases (12 total); description + `themes` keyword (output.json in lockstep).
- **`tsconfig.json`** — `resolveJsonModule` (static preset JSON imports; core stays zero-dep).

## The contract pair table (all text pairs gate at the system's declared level)

| fg | bg | kind |
|---|---|---|
| `text.emphasis`, `text.primary`, `text.secondary`, `text.muted` | `bg.base`, `bg.surface`, `bg.raised` | text |
| `accent.default` | `bg.base`, `bg.surface`, `bg.raised` | text |
| `accent.default` | `accent.subtle-bg` | text |
| `accent.on-accent` | `accent.default`, `accent.hover` | text |
| `status.{s}-text` | `status.{s}-bg` (×3) | text |
| `solid.on-{s}` | `solid.{s}` (×3) | text |
| `border.input` | `bg.base`, `bg.surface` | non-text (3:1) |
| `accent.focus-ring` | `bg.base`, `bg.surface`, `bg.raised` | non-text (3:1) |

Exempt by design (doc-commented in `roles.ts`): `text.disabled` (WCAG 1.4.3 exception),
`border.subtle/strong` (decorative separators), `status.*-bg` vs `bg.*` (tinted chips ~1:1),
`accent.subtle-bg` vs `bg.*`, `border.input` vs `bg.raised`.

## Verification

- `bun run check` green (551 tests; design:check gates objectcore at 58 contract pairs; activation
  routing for the 4 new cases runs in CI with the key).
- `presets.test.ts` headline: both presets instantiate with **zero errors at AAA** across all 15
  themes — the machine-checked proof of the POC's claims, via the gate's own math.
- Adversarial reviews (one per lane): alpha's reviewer independently recomputed 435/435 pairs from
  the committed JSON; beta's fuzzed escaping/determinism; gamma's stress-tested the solves on
  adversarial briefs; delta's audited all 13 plugins' trigger surfaces for distractor risk.
- Browser smoke: `design/objectcore/dist/spec.html` + a scratch-seeded inkwell spec page.

## Deliberately not built (follow-ups)

- Publishing preset token JSON at a fetchable registry route (consumer story beyond "copy the
  DTCG output"); engine bundling with the plugin stays behind the Stage 2/3 packaging caveat.
- APCA stays advisory; Figma/Tokens-Studio `TokenSource` adapters unchanged from plan 012's
  deferral list.
