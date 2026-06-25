---
description: Scaffold a new ObjectCore plugin from a spec — grill the request into a spec, plan the components and trigger surfaces, scaffold deterministically, then gate on validation + activation.
---
# /forge

Spec-driven generation of a new plugin. Four phases. Synthesis (1–2) is yours; the
scaffold (3) is deterministic; the gate (4) is non-negotiable.

## 1. Specify (grill)
Load the `specifying` skill. Interrogate the request until every branch resolves —
outcome, scope, non-goals, constraints, prior decisions, and how each outcome will be
verified. Pin the result. Do not advance while any answer is "it depends".

## 2. Plan
Load the `planning` skill (which conforms to `writing-great-skills`). Decide the
components, draft each skill's **trigger surface** (name + description) as a first-class
output, choose the progressive-disclosure layering and the catalog-entry shape, and
write the **activation eval cases** — positives that must fire each skill and negatives
(including a confusability negative) that must not. The output of this phase is a single
`PluginSpec` JSON.

## 3. Scaffold (deterministic)
Hand the `PluginSpec` to the scaffolder. It writes the plugin dir, components,
`evals/activation.json`, and `evals/output.json`, then re-derives and validates the
catalog:

```
bun run forge:scaffold <spec.json>
```

The scaffolder enforces the hard rules at write time (kebab-case names, components at the
plugin root, a string `repository`, an array `keywords`) and **refuses to emit a skill
without activation cases**. It will not overwrite an existing plugin without `--force`.

## 4. Gate
```
bun run eval
```
Validation proves the plugin loads; the activation eval proves its skills fire. A plugin
that parses but never activates is worse than one that fails to parse — do not consider it
catalog-ready until the gate is GREEN.

> Stage 2 attaches the Changeset and the release tag (`{plugin}--v{semver}`) at this step.
