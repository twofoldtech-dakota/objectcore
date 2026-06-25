// The release-tag format — single source of truth for `{plugin}--v{semver}`.
// It lives in the catalog layer (not the release engine) for two reasons:
//   1. deriveCatalog's SHA-pins reference it as the human-readable `ref` on a
//      git-subdir source, so the pure seam needs the format.
//   2. The Stage 2 release engine imports it to create the git tags it pushes.
// One format, imported both places — never re-spelled.

/** `hello-objectcore` + `0.1.0` -> `hello-objectcore--v0.1.0`. */
export function releaseTag(name: string, version: string): string {
  return `${name}--v${version}`;
}

/** Inverse of {@link releaseTag}. Returns null for strings that aren't release tags. */
export function parseReleaseTag(tag: string): { name: string; version: string } | null {
  const i = tag.lastIndexOf("--v");
  if (i <= 0) return null;
  const name = tag.slice(0, i);
  const version = tag.slice(i + 3);
  if (!name || !version) return null;
  return { name, version };
}
