---
description: Author a stack-agnostic design system from DTCG design tokens — quick-start from a curated seeded theme preset (inkwell, cathode) or grill the brand into a token spec, plan the foundations and tiers, scaffold an accessible-by-construction SSOT, then gate on validation + contrast + a judged on-brand review.
---
# /design

Spec-driven generation of a design system — the design layer a Figma designer
produces (color, type, spacing, motion), expressed as a machine-readable DTCG token
source of truth. A phase-0 fork picks the path; synthesis (1–2) is yours; the
scaffold (3) is deterministic; the gate (4) is non-negotiable.

## 0. Choose the path

Two paths converge on the same seam, the same gate, and the same sinks. Fork FIRST:

- **Quick start (seeded)** — no brand direction yet, prototyping, or the desired mood
  already matches a curated preset. Load `choosing-a-seeded-theme`, browse the
  inventory (`bun run design:seed --list`), then seed:

  ```
  bun run design:seed <preset> [--name <system>] [--themes a,b,c] [--out <dir>]
  ```

  This emits a complete `design/<name>/` system that already passes the gate — SKIP
  phases 1–3 and go straight to **4. Gate**.

- **Full custom (grilled)** — there is a brand guide, exact colors, or a multi-brand
  axis. Continue to **1. Define**.

Recommendation heuristic: if two or more of the user's mood adjectives live in one
preset's vocabulary (inkwell = quiet, editorial, warm paper; cathode = loud, technical,
emissive), seed it; otherwise grill. Escape hatch: a seeded system is a REAL SSOT, not
a demo — refine its tokens and re-gate anytime; nothing is thrown away by starting
seeded.

## 1. Define (grill)
Load the `defining-design-tokens` skill. Interrogate the brand until every foundation
resolves — brand hues + mood, the neutral, the spacing base unit, the type ratio,
fonts, and which color modes/brands exist. Pin a compact `ScaffoldSpec`. Do not advance
while a foundation is "it depends".

## 2. Plan (tiers + theming)
Decide the token TIERS (primitive scale → semantic alias → component) and, if there is
more than one mode/brand, the theming model — load `theming-with-tokens` (multiple sets
combined by a resolver, semantic aliases re-pointed; never duplicate). The output of
this phase is the finished `ScaffoldSpec` JSON.

## 3. Scaffold (deterministic)
Hand the spec to the generator. It emits the DTCG sets (`*.tokens.json`), the
`resolver.json`, a starter `evals/design.json`, and the derived views
(`dist/tokens.css`, per-theme JSON):

```
bun run design:scaffold <spec.json> [--out <dir>]
```

The generator builds the color scales **accessible by construction** (text steps'
lightness solved to meet WCAG on every canvas-class background — canvas, subtle,
surface) and **self-gates** — it refuses to emit a system that fails the deterministic
floor (valid DTCG, no circular refs, contrast, type/spacing scales).

## 4. Gate
Run the standing gate:

```
bun run design:check
```

It re-runs the deterministic floor (validation + contrast + scales) and, when an API
key is present, the judged half — "is it on-brand?" — via the per-system
`evals/design.json` against a `DesignJudge` (`runDesignEval`). A system that validates
and is accessible but reads as generic or off-brief is not done. Refine the spec and
re-scaffold until BOTH gates are green. (`design:check` is part of `bun run check`, so
the factory gate enforces this too.)

> To CONSUME the finished system in real UI, load the `design-foundations` skill — it is
> the reference for picking semantic tokens by role so output stays on-brand.

> **Where this runs:** the deterministic CLIs (`design:seed`, `design:scaffold`,
> `design:check`, `design:build`) run inside the ObjectCore repo. The OUTPUT is plain
> DTCG JSON + CSS variables — copy `design/<name>/` (or just its `dist/`) into any
> project. Bundling the engine for standalone distribution is deferred to the existing
> Stage 2/3 packaging caveat.
