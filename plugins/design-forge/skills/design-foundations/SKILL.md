---
name: design-foundations
description: The reference for CONSUMING a token-based design system so UI stays on-brand — pick the semantic token by ROLE, never a raw hex or scale step. Use when building, styling, or reviewing a component, page, or any visual output that must match the design system (choosing colors, spacing, type, radius, or motion).
---
# Design foundations (how to consume the system)

A design system is only on-brand if it is consumed by **role, not value**. Never paste a
hex, a raw OKLCH, or a bare scale step into a component. Reach for the **semantic token**
whose name states the intent — the system maps that role to the right value per theme, so
your UI is correct in light, dark, and every brand without you tracking colors.

## Color — pick by role (the 12-step scale)

Primitive scales are 12 steps, each with a FIXED ui role (the Radix convention). Choose
the step by what you are painting, then prefer the **semantic alias** over the raw step:

| Steps | Role | Typical semantic token |
|------|------|------------------------|
| 1–2  | app / canvas background | `bg.canvas`, `bg.subtle` |
| 3–5  | component / surface background, hovered/active | `bg.surface` |
| 6–8  | borders, separators, focus ring | `border.subtle`, `border.default`, `border.strong` |
| 9–10 | solid fills (brand), hovered solid | `accent.solid`, `accent.solid-hover` |
| 11   | low-contrast / secondary text | `text.subtle` |
| 12   | high-contrast / primary text | `text.primary` |

Rules of thumb: body text → step 12 (`text.primary`); secondary text → step 11; a brand
button fill → step 9 (`accent.solid`); a hairline → step 6–7. If you find yourself
reaching for a raw `color.*.<step>`, ask whether a semantic alias should exist instead.

## Type, spacing, radius, motion — use the scale, not magic numbers

- **Type**: use the named scale (`font.size.sm | base | lg | xl | …`); it is a modular
  ratio in **rem**. Never hardcode `px`. Pair with `font.weight.*` and a line-height.
- **Spacing**: every gap/padding is a step on the base-unit grid (`space.1 … space.24`).
  No off-grid values — they break vertical rhythm.
- **Radius**: `radius.sm | md | lg | full`.
- **Motion**: `motion.duration.fast|normal|slow` + `motion.easing.standard|…`. Respect
  `prefers-reduced-motion`.

## Accessibility is a floor, not a finish

Text/background pairs in the system already meet **WCAG 2.2** (4.5:1 body, 3:1 large/UI,
7:1 for primary text). If you combine tokens the system did NOT pre-pair (e.g. colored
text on a colored surface), re-check contrast — do not assume it passes.

## Theming is automatic if you stay semantic

Light/dark and multi-brand are switched by re-pointing semantic tokens (e.g. a
`[data-theme="dark"]` block of CSS variables). Consume `text.primary`/`bg.canvas` and the
theme just works; consume a raw step and you have pinned one appearance.
