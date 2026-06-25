---
description: Validate a plugin and the marketplace catalog against ObjectCore's hard rules — structural load-errors, catalog sync, and activation-eval coverage — then run the gate.
---
# /validate

Check that every plugin loads, the catalog is in sync, and every skill is gated.
Load the `validating-plugins` skill for the full rule reference.

## Run the gate
```
bun run check:catalog   # structural validation + marketplace.json is in sync (read-only)
bun run eval            # output + coverage evals (offline) + activation evals (needs a key)
```
Or both, plus tests and typecheck, in one shot:
```
bun run check
```

## When something fails
- **"out of date or hand-edited"** — `marketplace.json` is a build artifact; run `bun run build:marketplace` and commit. Never hand-edit it.
- **`repository` must be a string / `keywords` must be an array / name must be kebab-case** — hard load errors in Claude Code, fix the manifest.
- **`commands/`/`skills/` must be at the plugin root** — move them out of `.claude-plugin/` (which holds only `plugin.json`).
- **"skill has no positive activation case"** — add a case to `evals/activation.json` that expects the skill to fire. A skill that never fires is worse than one that fails to parse.
- **activation case fired the wrong skill** — tighten the skill's `description` (the trigger surface), not its body. Most activation failures are description failures.
