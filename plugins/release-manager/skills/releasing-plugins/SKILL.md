---
name: releasing-plugins
description: Reference for how ObjectCore releases plugins — the Changesets-driven version -> tag {plugin}--v{semver} -> SHA-pin -> attest flow, and the provenance rule for MCP-bundling plugins. Use when cutting a release, adding a changeset, bumping a plugin version, debugging the release CI, or reasoning about pinned catalog (git-subdir) sources.
---
# Releasing plugins (the Stage 2 flow)

A release turns the current plugin graph into **immutable, versioned, provenanced**
catalog entries. It never hand-edits versions or `marketplace.json` — like the build,
it is derived from intent. The intent here is a **changeset**.

```
changeset -> version -> tag {plugin}--v{semver} -> SHA-pin -> attest
```

The engine is `@objectcore/release` (pure: parse, semver, plan, changelog,
provenance); the `bun run release:*` scripts are the disk + git edge. Versions live in
each plugin's `plugin.json`; the catalog is always **re-derived** through the single
`deriveCatalog` seam — never a second path.

## 1. Changeset (declare intent)
Add `.changeset/<name>.md`. Keys are **plugin names** (must match a `plugins/` dir);
bumps are `major|minor|patch`; overlapping changesets for one plugin take the largest.

```md
---
"hello-objectcore": minor
---
What changed (becomes the CHANGELOG line).
```

## 2. Version (consume changesets)
```
bun run release:status     # preview the pending bumps
bun run release:version    # apply them
```
`release:version` bumps each plugin's `plugin.json`, keeps `evals/output.json`
`expectEntry.version` in lockstep (so the output eval still passes), prepends each
`CHANGELOG.md`, deletes the changeset files, and re-derives `marketplace.json`. In CI
this runs on `main` and opens the **Version PR**; merging it is what "cuts" the release.

## 3. Publish (tag + SHA-pin + attest)
```
bun run release:publish
```
Runs when no changesets remain. It:
- **tags** each plugin at its version as `{plugin}--v{semver}` (idempotent — only new versions),
- **SHA-pins** the catalog: `deriveCatalog(plugins, { shaPin, repoUrl })` rewrites every
  `source` to an immutable `git-subdir` pointer (`url` + `path` + `sha` + the `{plugin}--v{semver}` `ref`),
  written to `dist/marketplace.pinned.json` — the publish artifact,
- the CI workflow then **pushes** the tags and **attests** the pinned catalog with build
  provenance (`actions/attest-build-provenance`).

The pinned catalog is a publish-time view: the committed `marketplace.json` (derived
WITHOUT pins) is never touched, so `check:catalog` stays green.

## Hard rules
- **Provenance gate.** A plugin that bundles an MCP server (`mcpServers` in the manifest
  or an `.mcp.json` at its root) is a managed credential — `release:publish` refuses to
  publish it without attestation. CI publishes under attestation; locally pass `--attested`
  only when provenance is genuinely produced.
- **Never hand-edit versions or `marketplace.json`.** Add a changeset; let the engine bump
  and re-derive.
- **One tag format.** `{plugin}--v{semver}`, single-sourced as `releaseTag` in
  `registry-core` (also the `ref` on every pin) — never re-spelled.
- **Pin only at publish.** SHA-pins are immutable distribution; the dev catalog stays on
  bare relative-path sources.
