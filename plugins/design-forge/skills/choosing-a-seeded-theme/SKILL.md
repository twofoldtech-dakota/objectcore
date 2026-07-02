---
name: choosing-a-seeded-theme
description: Pick a READY-MADE seeded design theme instead of authoring one — the curated preset inventory (inkwell = quiet, editorial, warm paper; cathode = loud, technical, emissive) and when a preset beats a custom grill. Use when the user wants a quick-start design system, an off-the-shelf look, or asks which seeded preset/theme to pick — NOT for defining custom brand foundations from scratch (that is defining-design-tokens) and NOT for adding modes to existing tokens (that is theming-with-tokens).
---
# Choosing a seeded theme (the quick-start path)

Two curated presets ship with the engine. Each is a complete, designer-authored token
system — ramps, the full semantic role contract, and a wardrobe of named themes — that
already passes the same gate a scaffolded system must pass. Seeding one is the fastest
route from nothing to a real SSOT. Pick by MOOD, not by looking at values.

## The inventory

**inkwell** — quiet, editorial, warm paper. Ink on cream, one metal accent. For
products that should read calm and senior: writing tools, docs, long-form reading.

| Theme | Appearance | Character |
|-------|------------|-----------|
| `paper` | light (default) | The base — ink on warm paper, bronze only where it matters |
| `ink` | dark | The same warm neutrals reversed — reading after hours |
| `study` | dark | A dark library — umber walls, sage as the reading lamp |
| `kiln` | light | Blush clay paper, oxblood actions — gallery light |
| `arboretum` | light | Moss-filtered daylight, warm paper cards, deep green actions |
| `nocturne` | dark | Soot and terracotta shadow, amber lamplight — the late shift |

**cathode** — loud, technical, emissive (inkwell's opposite). Phosphor on dark glass,
one live wire. For dashboards, consoles, monitoring — anything instrument-flavored.

| Theme | Appearance | Character |
|-------|------------|-----------|
| `glass` | dark (default) | The base — phosphor on dark glass, one live wire |
| `daylight` | light | The away kit — the same live wire on cool paper-white |
| `terminal` | dark | Green phosphor on black glass — the original console |
| `blueprint` | light | Cyan-washed drafting paper, deep azure lines |
| `ledger` | light | Pale ledger green, ruled and balanced — accounting stock |
| `manila` | light | Folder-stock amber, warm and procedural — paperwork weather |
| `litmus` | light | Test-strip pink, acid-checked — diagnosis in daylight |
| `sonar` | dark | Cyan depth, green ping — instruments below the waterline |
| `redline` | dark | Soot chassis, klaxon signal — running hot on purpose |

## The decision rule

Collect the user's mood adjectives. If **two or more** live in one preset's vocabulary
(quiet/editorial/calm/warm/paper → inkwell; loud/technical/emissive/instrument/console
→ cathode), seed that preset. Fewer than two, or a strict brand guide with exact
colors? Grill instead — hand off to `defining-design-tokens`.

## How to run

```
bun run design:seed --list                                  # the live inventory
bun run design:seed <preset> [--name <system>] [--themes a,b,c] [--out <dir>]
bun run design:check                                        # the same standing gate
```

`--themes` takes a subset of the wardrobe (keep at least one light and one dark);
omit it for the full roster. The default theme becomes the `:root` output.

## Curated vs generated

A seeded system is curated — a designer's palette judgment, but VERIFIED by the same
contrast math the generator uses; "measured, not promised" holds on both paths. It is
also a real SSOT, not a demo: re-point semantic aliases, add a theme, re-gate — the
same lifecycle as a scaffolded system. Scope note: presets and the `design:seed` CLI
live inside the ObjectCore repo; the seeded output is plain DTCG JSON + CSS variables
you can copy into any project.
