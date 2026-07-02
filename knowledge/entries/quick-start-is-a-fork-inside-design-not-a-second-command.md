---
id: quick-start-is-a-fork-inside-design-not-a-second-command
type: decision
title: Quick-start is a fork inside /design, not a second command
tags: [design-forge, commands, trigger-surface, plan-014]
created: 2026-07-02
---

Plan 014 added the seeded-theme quick-start as phase 0 of the existing /design command rather than a new /design-quick. Commands are explicit human invocations, not judge-routed trigger surfaces — a second command buys zero activation clarity but adds a near-duplicate catalog surface whose description would overlap /design's, muddying the marketplace entry and the human mental model. The skill layer is where routing clarity lives: the new choosing-a-seeded-theme skill carries the preset inventory with a description explicitly disjoint from defining-design-tokens (the grill) and theming-with-tokens (modes over existing tokens).
