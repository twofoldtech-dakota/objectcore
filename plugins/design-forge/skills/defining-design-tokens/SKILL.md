---
name: defining-design-tokens
description: The grilling gate for AUTHORING a new design system or token set — turn a vague brand into a decided DTCG design-token spec before any scaffolding. Use at the start of /design, when brand direction (color, type, spacing, motion) is still fuzzy, or when deciding the token foundations and tiers.
---
# Defining design tokens (the authoring gate)

A design system is only as good as the decisions behind its tokens. Resolve every
foundation *before* scaffolding — a vague brief yields a generic, off-brand system that
validates but says nothing.

## Pin these before scaffolding

- **Brand color(s)** — the accent hue(s) in **OKLCH** (perceptual; degrees 0–360) and a
  rough chroma (vividness). Name the role (`accent`, maybe `success`/`warning`).
- **Neutral** — the gray's hue (usually the accent's hue at near-zero chroma) so grays
  feel related to the brand.
- **Mood** — 2–4 brand adjectives (e.g. "modern, trustworthy, calm"). These become the
  judged on-brand bracket (`evals/design.json`): the system must read AS them and must
  NOT read as their opposites.
- **Spacing base unit** — 4 or 8 px. Everything is a multiple.
- **Type ratio + base size** — a modular ratio (1.125 / 1.2 / 1.25 / golden) and a base
  (usually 16px → 1rem). Sizes are authored in **rem**, not px.
- **Fonts** — sans / serif / mono families.
- **Modes & brands** — how many color modes (light/dark) and brands? (Drives theming.)

## The DTCG grammar (the format the spec emits)

The source of truth is W3C DTCG JSON. A **token** is an object with a `$value` and a
`$type` from the fixed 13 (`color, dimension, fontFamily, fontWeight, duration,
cubicBezier, number, strokeStyle, border, transition, shadow, gradient, typography`).
Keys are `$`-prefixed (`$value`/`$type`/`$description`). A `$type` on a **group** is
inherited by its children.

## Tiers — primitive → semantic → component

1. **Primitive**: raw scales — a 12-step color ramp per family (steps map to fixed UI
   roles), the type scale, the spacing ladder, motion. No intent, just values.
2. **Semantic** (alias): named by *intent*, referencing primitives with `{group.token}`
   (e.g. `text.primary` → `{color.neutral.12}`). This is where on-brand decisions live
   and where theming happens. **References must not be circular.**
3. **Component**: optional, per-component tokens aliasing the semantic tier.

## Accessible by construction

Build color scales so text steps (11–12) meet WCAG on the canvas (steps 1–2) *by
design*, not by luck — the generator solves text lightness for the contrast target.
Pin the target (AA body / AAA primary) as a decision.

When every foundation above is decided (no "it depends"), hand off to the scaffolder
(`/design` step 3). If a brand mode/brand axis exists, design the theming first with
`theming-with-tokens`.
