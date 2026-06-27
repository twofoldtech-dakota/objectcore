---
name: theming-with-tokens
description: How to add dark mode or multi-brand theming to a token-based design system the RIGHT way — multiple token sets combined by a resolver with semantic aliases re-pointed per theme, never duplicated components. Use when adding a color mode, a second brand, or any theme axis over existing design tokens.
---
# Theming with tokens (multiple sets + a resolver)

Theming is **not** one file with magic switches, and it is **not** duplicating
components per mode. It is: keep ONE set of primitives, and provide a **semantic set per
appearance** that re-points the same intent tokens at different primitive steps. A
**resolver** selects + merges the sets for a given context, and aliases are resolved only
*after* the merge. This is the model DTCG's Resolver Module, Tokens Studio Themes, and
Figma variable modes all share.

## The mechanism

- **Sets**: `primitives` (shared scales), `semantic-light`, `semantic-dark`, plus
  `semantic-<brand>` for each brand. A semantic token is the same in every set —
  `text.primary` — but points at a different primitive step per appearance.
- **Resolver**: a `resolutionOrder` (set + modifier names, where **later overrides
  earlier**) and `modifiers` — a conditional axis like `theme` whose `contexts` map
  `{ light: ["semantic-light"], dark: ["semantic-dark"] }`. The runtime context
  (`{ theme: "dark" }`) selects which sets merge.
- **Resolution order matters**: primitives first, then the theme's semantic set on top.
  Aliases (`{color.neutral.12}`) are followed only after flattening the merge.
- **Output**: one resolved view per permutation — typically a `:root` block (the default
  theme) plus a `[data-theme="dark"]` block of the same CSS variables re-pointed. Brands
  add a second axis (a theme × brand matrix → one output per combination).

## Myths to avoid (these were checked and are false)

- ❌ "An ordered enable/disable stack cascades like CSS specificity." No — it's an
  explicit `resolutionOrder` where later entries override earlier, nothing implicit.
- ❌ "DTCG themes without any file/set duplication." No — theming requires multiple
  **sets** (a semantic set per appearance) plus the resolver step.

## Doing it right

1. Author intent ONCE in the semantic tier; never bake a hex into a component.
2. Add an appearance by adding a `semantic-<x>` set + a context entry — not by editing
   components.
3. Keep primitives appearance-neutral; only the semantic mapping changes per theme.
4. Verify contrast in EVERY derived theme — dark mode is where WCAG 2's math gets
   unreliable, so re-check each permutation.
