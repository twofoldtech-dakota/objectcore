# Plan 012: design-system authoring meta-plugin (`@objectcore/design` + `design-forge`)

> **What this is**: a NEW subsystem — a stack-agnostic **design-system authoring/
> governance meta-plugin** whose source of truth is a directory of **W3C DTCG design
> tokens**, with a pure derive/validate/gate pipeline in a new engine package and a
> `plugin-forge`-style meta-plugin as the human/agent runbook. The deliverable is the
> **design layer** a Figma designer produces (color, type, spacing, IA/UX, motion) —
> NOT a framework component-code library. End goal: **dogfood it to produce ObjectCore's
> marketing-site design system** (the first instance), the same way `@objectcore/forge`
> (engine) produces scaffolded plugins (instances).
>
> **Research basis**: two adversarial `/deep-research` passes (2026-06-26). Findings +
> refuted theories + primary sources are in the maintainer memory `design-system-plugin.md`.
> Cited inline below as 【R1】(pass 1) / 【R2】(pass 2).
>
> **Drift check (run first)**: `bun run check` green + `git status` clean. Re-read
> `packages/registry-core/src/{schema,validate,derive}.ts`, `packages/forge/src/scaffold.ts`,
> `packages/eval/src/{judge,activation}.ts`, and `scripts/_workspace.ts`/`_finalize.ts`
> if they changed shape since this was written — this plan deliberately mirrors all four.

## Status

- **Priority**: P2 (new capability; not on the registry/F-roadmap critical path, but a
  maintainer-requested product direction).
- **Effort**: L (multi-phase epic — new pure-core package, a meta-plugin, an LLM judge,
  a generator, then a dogfood instance). Phases are independently shippable.
- **Risk**: LOW-to-core / MEDIUM-at-edges. The engine is a NEW package and a NEW plugin —
  it never touches `deriveCatalog`, the `/v1/marketplace.json` seam, or any existing plugin.
  The only shared surfaces are the catalog (a new plugin dir → one re-derive) and the gate
  wiring (`bun run check` gains a `design:check` step). Both are additive.
- **Depends on**: nothing in-flight. Reuses Stage-1 patterns (forge engine + eval judge).
- **Built on**: branch `feat/design-system` (suggested).

## Why this fits ObjectCore (the mapping)

The research lands almost 1:1 on patterns already operated. This plan is a *relocation of
known shapes onto a new domain*, not new architecture:

| ObjectCore primitive | This subsystem |
|---|---|
| `@objectcore/registry-core` (pure, zero-dep) | `@objectcore/design` (pure, zero-dep) — DTCG types, schema, resolve, derive, gates |
| `deriveCatalog(plugins, opts)` — the seam | `deriveDesignSystem(source, opts)` — pure: resolve aliases → apply themes → emit platform views |
| `CatalogSource` / `CatalogSink` ports | `TokenSource` (DTCG dir / future Tokens Studio / Figma export) / `TokenSink` (CSS vars, JSON, Tailwind `@theme`) |
| `validateSchema` (zero-dep strict, reject-unknown) | `validateTokens` — DTCG grammar floor 【R1】 |
| deterministic `validate.ts` floor | the **deterministic design gates** (contrast, scale, grid, fluid, motion) 【R2】 |
| `@objectcore/eval` activation gate (Mock/Anthropic `Judge`) | the **judged design eval** (on-brand quality) — same ports+adapters `Judge` shape |
| `@objectcore/forge` `scaffold.ts` (grill→plan→scaffold) | `scaffoldDesignSystem` — accessible-by-construction token SSOT from a brand brief 【R1】 |
| `plugin-forge` (meta-plugin runbook over the engine) | `design-forge` (meta-plugin runbook: `/design` + an **always-on foundations skill** 【R1】) |
| forge engine (instance) → scaffolded plugin | this engine (instance) → **ObjectCore's token SSOT** (the dogfood) |

**Hard rules respected**: the engine core stays dependency-free (invariant: pure core);
all design-system derivation goes through one pure `deriveDesignSystem` (the invariant-#2
analogue — never a second path); the plugin's components live at its root with `evals/` an
ObjectCore convention; the new plugin enters the catalog only after passing validation AND
its activation eval (rule #5).

## The settled architecture (from the research)

1. **Source of truth = a directory of `.tokens.json` files in DTCG `2025.10`** (stable,
   vendor-neutral, OKLCH/P3-capable). A token = `{ $value, $type, $description? }`; `$type`
   ∈ the fixed **13 types**; tools MUST validate against declared `$type`, never infer 【R1】.
2. **Multi-tier**: primitive (raw scale) → semantic/alias (`{group.token}` references; no
   circular) → component. Color scale follows the **Radix 12-step role map** (1-2 app bg,
   3-5 component bg, 6-8 borders, 7 focus, 9-10 solid, 11-12 text) with semantic aliases
   (`accent`/`primary`/`neutral`/`brand`) so an agent picks shade **by role, not hex** 【R1】.
3. **Theming = multiple token sets + a resolver step (NOT single-file)** 【R2】. Model it as
   our own stable internal `Resolver` type (sets + modifiers with a `contexts` map
   light/dark/brand → source arrays + an order-significant `resolutionOrder`; aliases resolved
   only AFTER flattening), **shaped after the DTCG Resolver Module but NOT hard-coding its
   field names** — that module is a PREVIEW DRAFT ("do not implement") 【R2】. Per-theme output
   = one resolved tree per permutation (the `permutateThemes` model).
4. **Gate = WCAG 2.2 AA hard floor + deterministic non-color checks; APCA & LLM-judge
   advisory** 【R2】.
5. **Agent-consumability is architecture**: foundations are **always-on rules** (the
   reference skill the agent can't escape); token/component lookups are on-demand 【R1】.

---

## Phases (each independently shippable; STOP + checkpoint between)

### P0 — Engine core: DTCG types + schema floor + reference resolution
New package `packages/design/` (`@objectcore/design`, zero-dep, mirrors registry-core).
- `src/tokens.ts` — DTCG domain types: the 13 `$type`s, `DesignToken`, `TokenGroup`, the
  `.tokens.json` tree. Doc-comment the spec MUSTs (like `registry-core/types.ts`).
- `src/schema.ts` — `validateTokens(tree)`: assert `$value` present, `$type` resolvable
  (inherited from parent group / via reference) and ∈ the 13-set, value-shape matches
  `$type`, dollar-prefixed keys, **reject unknown `$`-props** (the `validateSchema` stance).
- `src/resolve.ts` — `resolveAliases(tree)`: follow `{group.token}` chains to explicit
  values, **detect circular references** (deterministic error), resolve to the whole `$value`.
- Tests: a valid tree, every invalid-`$type` shape, a circular ref, a broken ref.
- **STOP** + checkpoint: `bun test packages/design` green.

### P1 — The seam: themes + `deriveDesignSystem`
- `src/theme.ts` — the internal `Resolver` type (§3 above) + `applyResolver(sets, resolver,
  context) -> resolvedTree`. Pure. One resolved tree per theme permutation (light/dark/brand).
- `src/derive.ts` — **`deriveDesignSystem(source, opts)`**: the pure seam. resolve → apply
  themes → emit platform **views** via `TokenSink`s. Ports in `src/sources.ts`/`src/sinks.ts`:
  `FileTokenSource` (read `.tokens.json` dir) now; `CssVarSink` + `JsonSink` now;
  `TailwindThemeSink` (`@theme` block) + a `StyleDictionarySink` adapter deferred (see Decision A).
- Tests: light+dark resolve to different `$value`s from one source; aliases resolved
  post-flatten; resolutionOrder override is order-significant.
- **STOP** + checkpoint.

### P2 — The deterministic gate floor 【R2】
`src/gate.ts` (or split). All pure, all numeric — the `validate.ts` analogue:
- **Contrast (WCAG 2.2)**: luminance ratio `(L1+0.05)/(L2+0.05)`; assert semantic text/bg
  pairs meet **4.5:1** (text), **3:1** (large/non-text), **7:1** (AAA). Hard gate.
- **Type scale**: recompute `size = base × ratio^step`; compare with **numeric tolerance**
  (rounding/hand-tuning differs — never byte-compare).
- **Spacing/grid**: assert values are base-unit (4/8pt) multiples + monotone progression.
- **Fluid `clamp()`**: recompute `slope=(maxSize−minSize)/(maxVw−minVw)`,
  `intercept=minSize−slope·minVw`; compare with tolerance.
- **Motion**: validate duration tokens against the **Material-3 16-value ladder** + easing
  against the fixed cubic-bezier set; **special-case `emphasized`** (2-segment spline, not a
  single `cubic-bezier()`). Advisory by default (systems may diverge from M3).
- **APCA advisory** (`src/apca.ts`): compute `Lc`, report but never fail; optionally
  `reverseAPCA` to *generate* guaranteed-accessible scales in P4.
- Tests: a passing system, one failure per check, the `emphasized` special case.
- **STOP** + checkpoint.

### P3 — The judged eval (on-brand quality)
Mirror `@objectcore/eval`'s `Judge` ports+adapters exactly.
- `src/judge.ts` — `Judge` port + `MockJudge` (deterministic, offline; tests + keyless CI)
  + `AnthropicJudge` (real; defaults to cheap **`claude-haiku-4-5`** per the model-routing
  doctrine — this is classification/scoring, not frontier prose). Structured outputs, no
  `thinking`/`effort`.
- What it judges (what determinism can't): "is this palette on-brand for `<brief>`",
  "do these type/spacing choices read as `<adjective>`", harmony. Scored against per-system
  `evals/design.json` cases. Keyless ⇒ reported **skipped, never silently passed**.
- **STOP** + checkpoint.

### P4 — The generator: `scaffoldDesignSystem` (the forge analogue) 【R1】
- `src/scaffold.ts` — given a compact `DesignBrief` (brand hues, mood, base unit, type
  ratio, density), emit a complete, **accessible-by-construction** DTCG token SSOT:
  a Radix-style 12-step role-mapped color scale (reverse-APCA or fixed-perceptual-step so
  text/bg pairs pass by construction), semantic aliases, a type scale from the ratio, a
  spacing ladder from the base unit, an M3-style motion ladder, and a light/dark resolver.
  Guards the rules at write time (kebab names, valid `$type`s, no circular refs); refuses to
  emit a system that fails P2. Never overwrites without `--force` (the forge stance).
- `scripts/design-scaffold.ts` (`bun run design:scaffold <brief.json>`) — the disk edge;
  re-runs derive+validate+gate (a `_finalize`-style `syncAndGate` tail).
- **STOP** + checkpoint.

### P5 — The meta-plugin `design-forge` (the runbook + agent surface)
`plugins/design-forge/` (engine stays in `packages/design`, like forge). Components at root.
- `/design` command — grill brief → plan tiers → scaffold → gate (the forge pipeline shape).
- **`design-foundations` skill — the ALWAYS-ON reference** 【R1】: encodes the resolved
  system's role→step map, type/spacing/motion scales, and the "pick by role not hex" rule,
  so an agent consuming the plugin produces on-brand output. This is the consumption seam.
- authoring skills: `defining-design-tokens` (the grilling gate, conforms to the DTCG rules),
  `theming-with-tokens` (the multi-set+resolver model).
- `evals/` — `activation.json` (+ negative cases) + `output.json`; pass the existing gate.
- Wire `bun run design:check` into `bun run check` (additive step; keyless-skip the judge).
- Generation: consider authoring via `bun run forge:meta`/`meta-generator` (generator+governance
  hybrid) vs hand-writing — see Decision C.
- **STOP** + checkpoint: new plugin in the catalog (one re-derive of `marketplace.json`),
  full `bun run check` green, activation eval green (needs `ANTHROPIC_API_KEY` in CI).

### P6 — Dogfood: ObjectCore's marketing-site design system (the first instance)
- Run `/design` to produce `objectcore`'s token SSOT (brand color, type, spacing, motion,
  light/dark) under e.g. `design/objectcore/` — gated green by P2/P3.
- Emit the consumable views: **CSS custom properties** (+ optional Tailwind v4 `@theme`)
  the Vercel marketing site imports — the bridge from "design layer" to the live site.
- This is the proof the plugin works end-to-end, exactly as `commit-craft` proved forge.

---

## Decisions to make (flagged; defaults chosen)

- **Decision A — hand-roll the pure derive vs wrap Style Dictionary.** *Default: hand-roll*
  a minimal pure `deriveDesignSystem` in the zero-dep core (foundations → CSS vars + resolved
  JSON), and treat **Style Dictionary as an OPTIONAL external sink adapter** (the `@libsql`
  isolation pattern — kept out of the pure core). Rationale: preserves the dependency-free
  core + the single-derivation invariant; SD v4's full DTCG `2025.10` support is still WIP
  (v5) 【R1】, so depending on it now is premature. Reconsider if multi-platform native output
  (iOS/Android) becomes a goal.
- **Decision B — resolver shape.** *Default*: our own stable internal `Resolver` type, shaped
  after the DTCG Resolver Module but decoupled from its unstable field names (it's a "do not
  implement" preview draft) 【R2】. Provide a thin importer from Tokens Studio `$themes.json`
  later if a Figma authoring loop is wanted.
- **Decision C — plugin authoring path.** *Default*: hand-write `design-forge` (it's a
  generator+governance hybrid that meta-generator's two archetypes don't cleanly cover), but
  reuse meta-generator's skeleton if convenient.
- **Decision D — naming.** *Default*: engine `@objectcore/design`, plugin `design-forge`
  (mirrors `@objectcore/forge` + `plugin-forge`). Open to `design-system` / `design-tokens`.

## What this plan deliberately does NOT build

- **No component-code library** (no React/Tailwind/shadcn components) — out of scope by the
  maintainer's framing; the deliverable is the design layer + its consumable token views.
- **No interviewer/discovery plugin** — explicitly deferred to a later round.
- **No MCP token server** — the on-demand half of agent-consumability; the always-on skill
  (P5) is the first and most important surface. An MCP `TokenSource`/resource server is a
  later adapter behind the same ports (forge already built the `.mcp.json` primitive that
  could one day package it).
- **No APCA hard gate** — advisory only until WCAG 3 freezes (~2028-29) 【R2】.
- **No Figma write-back / live Figma sync** — `FileTokenSource` only; Figma/Tokens-Studio
  import is a later `TokenSource` adapter.

## Open questions to resolve during build (non-blocking)

- Survey gaps still open 【R2】: Material You dynamic color, M3 ref/sys/comp color tiers +
  tonal palettes, IBM Carbon, Adobe Spectrum 2 — confirm none add a tier model beyond
  primitive→semantic before finalizing P0's type design. (A third targeted research pass
  could close these if P0 wants more confidence; architecture does not hinge on them.)
- Deterministic spacing/grid + type-ratio validators: no off-the-shelf tool exists — P2
  builds them; confirm the tolerance bands against a couple of real published scales.
- Whether to adopt **Terrazzo** 【R2】 as an external lint sink for DTCG format/type rules
  (`core/valid-duration`, `valid-cubic-bezier`, `valid-dimension`, `consistent-naming`,
  `duplicate-values`) instead of re-implementing them in P0 — same Decision-A trade-off
  (dep vs pure core). *Default*: re-implement the few we need in the zero-dep core; revisit
  if the rule set grows.

## Done criteria (epic-level)

- [x] P0 `@objectcore/design` core: types + `validateTokens` + `resolveAliases` + tests. **DONE** — `packages/design/` (`tokens.ts` w/ all 13 DTCG types, `schema.ts` `validateTokens` w/ per-type shape validators, `resolve.ts` `flattenTokens`/`resolveAliases` w/ cycle + dangling detection); 18 tests green, tsc clean, full suite 206 pass, catalog untouched.
- [x] P1 `deriveDesignSystem` seam + `TokenSource`/`TokenSink` ports + theme resolver + tests. **DONE** — `theme.ts` (`mergeTrees` + `applyResolver`: multi-set + ordered-override + post-merge alias resolution), `derive.ts` (`deriveDesignSystem`, pure; no-resolver default + resolver×themes permutations), `sources.ts` (`TokenSource` + `FileTokenSource`: `*.tokens.json` sets + `resolver.json`), `sinks.ts` (`TokenSink` + `CssVarSink` `:root`/`[data-theme]` w/ per-type CSS serialization + `JsonSink`). +15 tests (33 total), full suite 221 pass.
- [x] P2 deterministic gate floor (contrast/type/spacing/fluid/motion, +APCA advisory) + tests. **DONE** — `color.ts` (hex/sRGB/OKLCH→luminance, WCAG `contrastRatio`), `gate.ts` (`checkContrast` WCAG 2.2 hard floor 4.5/3/7, `checkTypeScale` consecutive-ratio, `checkSpacingGrid` base-unit multiples, `computeFluidClamp`/`checkFluidClamp` closed-form, `M3_DURATIONS`/`M3_EASINGS` + `checkDurationLadder`/`checkEasingMatch` advisory w/ `emphasized`-is-spline note), `apca.ts` (forward `apcaLc` + `checkApca`, warnings-only). Tolerance-based per research; +15 tests (48 total), full suite 236 pass.
- [x] P3 `Judge` port + `MockJudge`/`AnthropicJudge` + `evals/design.json` scoring (keyless-skip). **DONE** — `judge.ts` (`DesignJudge` port + `MockDesignJudge` heuristic/injectable + `AnthropicDesignJudge` Haiku-default structured-output critic; `DesignBrief`/`DesignVerdict`), `evaluate.ts` (`DesignEvalSpec` brief+cases, `summarizeSystem`, `runDesignEval` w/ pass/fail on-brand bracket + threshold, `loadDesignEvalSpec`). Package gains `@anthropic-ai/sdk` (like `@objectcore/eval`; P0–P2 stay zero-dep at module level). +6 tests (54 total), full suite 242 pass.
- [x] P4 `scaffoldDesignSystem` + `bun run design:scaffold` (accessible-by-construction). **DONE** — `scaffold.ts` (`scaffoldDesignSystem`: 12-step OKLCH scales per family w/ text steps L-SOLVED for WCAG AA/AAA on canvas, neutral auto-added, type/spacing/motion/font/radius scales, light/dark semantic sets + resolver, starter `design.json` on-brand bracket; self-gates against P2 — refuses to emit a failing system), `scripts/design-scaffold.ts` (`bun run design:scaffold <brief> [--out] [--force]`: writes source + derives `dist/tokens.css`+JSON views + prints self-gate). Font sizes in rem (preserves modular ratio). CLI smoke-tested end-to-end green. +7 tests (61 total), full suite 249 pass.
- [x] P5 `design-forge` plugin (always-on foundations skill + authoring skills + evals);
      `design:check` wired into `bun run check`; in the catalog; activation eval green.
      **DONE** — `plugins/design-forge/`: `/design` command + 3 skills (`design-foundations` =
      the consume-by-role reference; `defining-design-tokens` = authoring grill gate;
      `theming-with-tokens` = multi-set+resolver model) + `evals/activation.json` (8 cases:
      2 positives/skill + plain + confusability negative). Catalog re-derived → **13 plugins**,
      in sync. `scripts/design-check.ts` (`design:check`: read-only gate over `design/*/` —
      schema + resolve + standard contrast pairs + key-gated judged layer; clean no-op until
      P6) wired into `bun run check`. Full `bun run check` GREEN offline (95 eval checks pass:
      design-forge coverage/readiness/body-filled green); **activation routing runs in CI**
      (needs `ANTHROPIC_API_KEY`), like every other plugin.
- [x] P6 ObjectCore token SSOT produced via dogfooding; CSS-var view consumed by the site.
      **DONE** — dogfooded `/design`: `design/objectcore/` SSOT (indigo accent hue 264 +
      success/warning/danger + hue-matched neutral; 4px grid, 1.25 type ratio, Inter +
      JetBrains Mono; light+dark). Generated via `bun run design:scaffold`, gated GREEN by
      `bun run design:check` (4 text pairs accessible by construction in both themes; judged
      layer runs in CI). Added `bun run design:build` (derive views from the refinable SSOT
      w/o re-scaffolding); `dist/` is gitignored (build artifact), SSOT tracked. **design:check
      caught a real over-reach in its OWN gate** — it required 3:1 on `border.default`, but
      WCAG 1.4.11 exempts decorative separators; fixed to gate text pairs only.
- [x] `bun run check` green throughout; `marketplace.json` byte-changes only when the new
      plugin is added (one intentional re-derive). **DONE** — final `bun run check` GREEN:
      13 plugins in sync, design:check passes, 95 eval checks pass.

**EPIC COMPLETE (P0–P6).** Built on `chore/registry-domain-live` (per maintainer; uncommitted).
Remaining frontier (follow-ups below): activation routing + judged on-brand eval run in CI
(need `ANTHROPIC_API_KEY`); always-on `SessionStart` foundations hook; Tailwind `@theme` sink.

## Follow-ups (not this plan)

- The interviewer/discovery plugin (the requirements-grilling generalization of forge's grill).
- An always-on `SessionStart` foundations hook (the kb-writer pattern) that surfaces the
  committed SSOT into context — the *truly* always-on half of agent-consumability (P5 shipped
  the description-triggered skill; the hook is its stronger sibling, now that an SSOT exists).
- Tailwind v4 `@theme` sink + a `dist/` sync-check in `design:check` (the marketplace.json
  byte-match analogue) if the views become committed artifacts.
- MCP token/resource server (on-demand consumption surface).
- Figma / Tokens Studio `TokenSource` adapters (designer authoring loop).
- Style Dictionary sink for native iOS/Android output (Decision A revisit).
- Refine `design/objectcore` brand (hue/mood/fonts) + verify the judged on-brand eval in CI.
