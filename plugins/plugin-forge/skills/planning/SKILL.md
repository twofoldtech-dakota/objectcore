---
name: planning
description: Turn a pinned plugin spec into a concrete PluginSpec the scaffolder can emit — choosing components, drafting each skill's trigger surface, and writing the activation eval cases. Use after specifying, when converting a spec into the JSON for bun run forge:scaffold.
---
# Planning

Convert the pinned spec into a `PluginSpec` the scaffolder consumes. This skill conforms to `writing-great-skills` — read it for the metadata / body / reference discipline.

Decide, in order:

1. **Components.** Map each outcome to the smallest component that enforces it. Prefer several small, composable skills over one monolith.
2. **Trigger surface (first-class output).** For each skill, draft `name` + `description` so it fires on the right task and stays quiet on near-misses. Most skill failures are description failures. Build the description from three parts: the **artifact** it acts on (e.g. "the staged diff"), the **form** of the output (e.g. "conventional-commits style"), and the **enumerated entry-triggers** (e.g. "about to commit / asks for a message / wants wording improved"). Then check it against the *sibling* surfaces already in the catalog so it doesn't overlap one of them.
3. **Layering.** Split each skill into metadata (always-on), body (loaded on match), and reference (pulled on demand). Pay token cost only for the layer reached.
4. **Catalog shape.** Version (start `0.0.1`), keywords, optional category, and a **string** `repository`. These become the catalog entry via `deriveCatalog`. `category` (optional) must come from the catalog's vocabulary — `workflow | governance | generator | meta | example` — or be omitted; do not invent a one-off string.
5. **Activation cases.** For each skill, write a **budget** of cases, not a token one: **≥2 positives** covering *distinct* intents (e.g. drafting vs. revising), **≥1 plain negative** (clearly unrelated), and **≥1 confusability negative** that shares vocabulary with a *sibling* catalog surface but has the wrong intent. These become `evals/activation.json` and are what gate the plugin. The gate now enforces both halves: a skill needs a positive case (or the scaffold refuses it) **and** the plugin needs a negative case (or coverage fails).

## PluginSpec (what the scaffolder consumes)

```json
{
  "name": "kebab-name",
  "description": "one line — also the catalog entry's description",
  "version": "0.0.1",
  "keywords": ["objectcore"],
  "skills": [
    { "name": "do-x", "description": "Use when …", "body": "# Do X\n\nReal instructions: the steps, the output format, any reference to load." }
  ],
  "commands": [{ "name": "run-x", "description": "…" }],
  "activation": [
    { "prompt": "a prompt that should fire do-x", "expect": "do-x" },
    { "prompt": "a near-miss that should not fire anything", "expect": null }
  ]
}
```

A skill `body` is **required for real (non-meta) plugins** — omit it and the scaffolder emits a visible TODO stub comment that the eval gate rejects (`body-filled`). Write the actual instructions here.

Emit this JSON, then run `bun run forge:scaffold <spec.json>` followed by `bun run eval`.
