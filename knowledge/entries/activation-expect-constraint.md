---
id: activation-expect-constraint
type: gotcha
title: An activation case's expect must be null or a skill in the SAME plugin
tags: [forge, evals, activation]
source: packages/forge/src/scaffold.ts
created: 2026-06-26
---

In a plugin's `evals/activation.json`, a case's `expect` must be either `null` or
the name of a skill declared in THAT plugin (enforced by scaffold.ts's pre-write
cross-check). You cannot assert that a prompt routes to a *sibling* plugin's skill.

So a confusability negative aimed at another plugin must be `expect: null` — a
near-miss where nothing should fire — NOT `expect: "<sibling-skill>"`. The
cross-plugin boundary is still tested, but from the sibling's own positive cases:
the activation judge picks a single skill across the whole catalog, so if the
sibling's positive passes, this plugin did not steal that prompt.
