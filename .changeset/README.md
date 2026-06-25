# Changesets — ObjectCore

This folder drives the Stage 2 release pipeline. We adopt the **Changesets file
format** but version **plugins** (`plugin.json`), not npm packages — because a
plugin is a directory discovered at runtime, not a workspace. So the `@changesets`
CLI's `version`/`publish` are replaced by ObjectCore's own engine
(`@objectcore/release`) and the `bun run release:*` scripts.

## Add a changeset

Create a file `.changeset/<any-name>.md` describing the change:

```md
---
"hello-objectcore": minor
"plugin-forge": patch
---

A one-line summary that becomes the CHANGELOG entry for each plugin above.
```

- Keys are **plugin names** (must match a directory under `plugins/`). A name that
  matches no plugin fails `release:version`.
- Bumps are `major` | `minor` | `patch`. Overlapping changesets for one plugin take
  the **largest** bump.

## Commands

```bash
bun run release:status     # preview what the pending changesets would release
bun run release:version    # consume changesets: bump versions, changelogs, re-derive catalog
bun run release:publish    # tag {plugin}--v{semver}, SHA-pin the catalog, (CI) attest
```

CI (`.github/workflows/release.yml`) runs `release:version` to open a **Version PR**
when changesets exist, and `release:publish` (tag + SHA-pin + attest) when they're
consumed. See the `release-manager` plugin's `releasing-plugins` skill for the full
runbook.
