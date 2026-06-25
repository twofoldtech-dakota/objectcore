---
description: Prepare or publish an ObjectCore plugin release: add a changeset, version plugins, tag {plugin}--v{semver}, SHA-pin the catalog, and attest. Use when staging or cutting a release.
---
# /release

Releases are **derived from changesets**, never hand-edited. Load the
`releasing-plugins` skill for the full flow and the hard rules.

## Stage a change
Add `.changeset/<name>.md` naming the plugins and their bumps:
```md
---
"hello-objectcore": minor
---
What changed.
```

## Preview
```
bun run release:status
```
Shows what the pending changesets would bump (and fails on a name that matches no plugin).

## Version (open the Version PR)
```
bun run release:version
```
Bumps `plugin.json` versions, updates CHANGELOGs + `evals/output.json`, deletes the
changesets, and re-derives `marketplace.json`. On `main`, CI does this and opens the
**Version PR**.

## Publish (after the Version PR merges)
```
bun run release:publish
```
Tags `{plugin}--v{semver}`, SHA-pins the catalog to the release commit
(`dist/marketplace.pinned.json`, `git-subdir` sources). CI then pushes the tags and
attests the artifact with build provenance.

## Rules
- **Never hand-edit versions or `marketplace.json`** — add a changeset, let the engine derive.
- **Provenance gate** — a plugin bundling MCP is a managed credential; publish blocks it without attestation.
- The flow you run locally is identical to the release CI (`.github/workflows/release.yml`).
