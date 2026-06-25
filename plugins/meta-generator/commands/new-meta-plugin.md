---
description: Generate a new meta-plugin (a plugin that produces or governs other plugins) from an archetype. Use when adding another generator or governance plugin to the factory, not an ordinary leaf plugin.
---
# /new-meta-plugin

Produce a new **meta-plugin** — one whose job is to produce or govern other plugins.
For an ordinary leaf plugin, use `/forge` instead. Load the `meta-plugin-archetypes`
skill for the two shapes.

## 1. Pick an archetype
- **generator** — grill → plan → scaffold a new artifact (like `plugin-forge`).
- **governance** — a `/verb` command + a reference skill over a rule set, pointing at the checks (like `plugin-validator`, `marketplace-builder`).

## 2. Write a meta-spec
A compact JSON the engine expands into a full, gate-passing `PluginSpec`:

```json
{
  "archetype": "governance",
  "name": "naming-czar",
  "description": "Governs plugin and component naming conventions.",
  "skill": { "name": "naming-rules", "description": "Use when reviewing plugin or component names against the conventions." },
  "command": { "name": "check-names", "description": "Check names against the conventions and report violations." },
  "activation": [
    { "prompt": "is `MyPlugin` an acceptable plugin name here?", "expect": "naming-rules" },
    { "prompt": "what's a good name for my dog?", "expect": null }
  ]
}
```

`metaPluginSpec` tags it as a meta-plugin of the archetype (keywords) and guarantees the
skill has a positive activation case. The `author` defaults to the marketplace owner.

## 3. Generate + gate
```
bun run forge:meta <meta-spec.json>
```
Scaffolds the plugin, re-derives the catalog, and runs the offline gate (validation +
output + coverage). Then **refine the generated prose and activation cases** — the
template gives a correct skeleton, not finished trigger surfaces — and run:
```
bun run eval
```
A meta-plugin is catalog-ready only when its activation gate is GREEN.
