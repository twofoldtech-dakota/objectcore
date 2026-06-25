---
description: Re-derive the marketplace catalog from the plugin graph and keep it in sync — the derive → validate → write flow. Use after adding, removing, or changing a plugin, or when marketplace.json is reported out of date.
---
# /build-marketplace

`marketplace.json` is a **build artifact** of the plugin graph, never hand-edited.
Load the `building-the-catalog` skill for how the seam works.

## Re-derive + write
```
bun run build:marketplace
```
Lists every plugin under `pluginRoot`, runs them through `deriveCatalog`, validates,
and writes `.claude-plugin/marketplace.json`. Run this after any plugin change, then
commit the result alongside it.

## Verify without writing (CI / pre-commit)
```
bun run check:catalog
```
Fails if the committed catalog drifts from what `deriveCatalog` produces — a hand-edit
or a forgotten re-derive.

## Rules
- **Never hand-edit `marketplace.json`.** Change the plugin, then re-derive.
- **One derivation path.** All derivation goes through `deriveCatalog`; do not add a second.
- **Every plugin dir ↔ exactly one catalog entry.** No stale, duplicate, or orphan entries — the sync invariant fails the build otherwise.
- The catalog URL is the permanent seam; today Git source + file sink, later a DB source + HTTP. The flow you run here is identical to the one the backend will run.
