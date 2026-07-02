---
name: validating-plugins
description: The reference for what makes an ObjectCore plugin valid — the hard load-error rules (manifest shape, kebab-case, component placement) and the eval-coverage gate. Use when a plugin fails to load or validate, when reviewing a plugin before it enters the catalog, or when diagnosing which hard rule a plugin manifest breaks. (A stale or drifted marketplace.json is building-the-catalog's territory.)
---
# Validating plugins (the rule reference)

Validation proves a plugin *loads* and is *gated*; it is the floor the eval gate sits on. The rules below are enforced by `registry-core` (`validateAll`) and the eval harness — `/validate` runs them.

## Hard load errors (Claude Code rejects the plugin)
- **`name` is kebab-case**, required, and unique in the catalog.
- **`repository` is a string**, never an object.
- **`keywords` is an array**, never a string.
- **Components live at the plugin root** — `commands/`, `agents/`, `skills/`, `hooks/`. `.claude-plugin/` holds only `plugin.json`.
- **Marketplace `name` is kebab-case and not on Anthropic's reserved list.**

## Catalog invariants (the seam)
- **`marketplace.json` is a build artifact** — derived by `deriveCatalog`, never hand-edited. Every plugin dir maps to exactly one catalog entry and vice-versa (no stale, no duplicate, no orphan).
- After changing a plugin, re-derive with `bun run build:marketplace`; `bun run check:catalog` fails if the committed file drifts.

## Gate invariants (beyond loading)
- **Every catalog entry has a description** (output eval) — an entry with none is invisible in `/plugin`.
- **Every skill has a positive activation case** (coverage eval) — a skill with no case targeting it would enter the catalog ungated.
- **Every activation case routes correctly** (activation eval) — positives fire the intended skill; negatives, including confusability negatives, fire nothing.

## Order of operations
Structural validation (does it load?) → coverage (is every skill gated?) → activation (do the skills actually fire?). A plugin is catalog-ready only when all three are green.
