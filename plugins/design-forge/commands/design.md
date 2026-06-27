---
description: Author a stack-agnostic design system from DTCG design tokens — grill the brand into a token spec, plan the foundations and tiers, scaffold an accessible-by-construction SSOT, then gate on validation + contrast + a judged on-brand review.
---
# /design

Spec-driven generation of a design system — the design layer a Figma designer
produces (color, type, spacing, motion), expressed as a machine-readable DTCG token
source of truth. Four phases. Synthesis (1–2) is yours; the scaffold (3) is
deterministic; the gate (4) is non-negotiable.

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
lightness solved to meet WCAG on the canvas) and **self-gates** — it refuses to emit a
system that fails the deterministic floor (valid DTCG, no circular refs, contrast,
type/spacing scales).

## 4. Gate
The deterministic floor ran in step 3. The judged half — "is it on-brand?" — runs the
per-system `evals/design.json` against a `DesignJudge` (`runDesignEval`, needs an API
key). A system that validates and is accessible but reads as generic or off-brief is not
done. Refine the spec and re-scaffold until BOTH gates are green.

> To CONSUME the finished system in real UI, load the `design-foundations` skill — it is
> the reference for picking semantic tokens by role so output stays on-brand.
