---
name: planning
description: Turn a pinned plugin spec into a concrete PluginSpec the scaffolder can emit — choosing components, drafting each skill's trigger surface, and writing the activation eval cases. Use after specifying, when converting a spec into the JSON for bun run forge:scaffold.
---
# Planning

Convert the pinned spec into a `PluginSpec` the scaffolder consumes. This skill conforms to `writing-great-skills` — read it for the metadata / body / reference discipline.

Decide, in order:

1. **Components.** Map each outcome to the smallest component that enforces it. Prefer several small, composable skills over one monolith.
2. **Trigger surface (first-class output).** For each skill, draft `name` + `description` so it fires on the right task and stays quiet on near-misses. Most skill failures are description failures — spend real effort here.
3. **Layering.** Split each skill into metadata (always-on), body (loaded on match), and reference (pulled on demand). Pay token cost only for the layer reached.
4. **Catalog shape.** Version (start `0.0.1`), keywords, optional category, and a **string** `repository`. These become the catalog entry via `deriveCatalog`.
5. **Activation cases.** For each skill, write positive prompts that must fire it and negatives that must not — include at least one *confusability* negative (shares words, wrong intent). These become `evals/activation.json` and are what gate the plugin.

## PluginSpec (what the scaffolder consumes)

```json
{
  "name": "kebab-name",
  "description": "one line — also the catalog entry's description",
  "version": "0.0.1",
  "keywords": ["objectcore"],
  "skills": [
    { "name": "do-x", "description": "Use when …", "body": "# optional markdown body" }
  ],
  "commands": [{ "name": "run-x", "description": "…" }],
  "activation": [
    { "prompt": "a prompt that should fire do-x", "expect": "do-x" },
    { "prompt": "a near-miss that should not fire anything", "expect": null }
  ]
}
```

Emit this JSON, then run `bun run forge:scaffold <spec.json>` followed by `bun run eval`.
