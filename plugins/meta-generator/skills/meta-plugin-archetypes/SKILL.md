---
name: meta-plugin-archetypes
description: Reference for the two ObjectCore meta-plugin archetypes — generator and governance — and the meta-spec the engine expands. Use when designing a new meta-plugin, choosing its archetype, or deciding whether something should be a meta-plugin at all.
---
# Meta-plugin archetypes

A **meta-plugin** produces or governs other plugins; it is a first-class catalog entry, gated like any other. The factory's existing meta-plugins fall into two shapes — reuse them rather than inventing a third without reason.

## generator
Produces a new artifact through phases. Shape: a driving command + one or more workflow skills (+ optionally a deterministic engine in `packages/`). The split is doctrine: **synthesis phases are prose; the scaffold is code.**
- Example: `plugin-forge` — `/forge` drives grill → plan → scaffold → gate; skills `specifying`, `planning`, `writing-great-skills`; engine `@objectcore/forge`.

## governance
Enforces or documents a rule set. Shape: a `/verb` command (the runbook) + a reference skill (the rules) that point at the actual checks. The enforcement *logic* lives in `packages/` (`registry-core`, `@objectcore/eval`); the plugin is the human/agent-facing surface.
- Examples: `plugin-validator` (`/validate` + `validating-plugins`), `marketplace-builder` (`/build-marketplace` + `building-the-catalog`).

## Is it actually a meta-plugin?
If it produces or governs *other plugins or the catalog*, yes. If it does work for an end user (a leaf capability), it's an ordinary plugin — use `/forge`.

## The meta-spec
`metaPluginSpec` expands a compact spec into a full `PluginSpec`: it tags `keywords` with `objectcore`, `meta`, and the archetype, and guarantees the skill has a positive activation case (coverage). It does **not** set identity — the CLI defaults `author` to `objectcore.config.json`'s `owner`. The generated trigger surfaces and activation prose are a *skeleton*: refine them, then pass the activation gate before the meta-plugin enters the catalog.
