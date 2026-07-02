// The version-immutability contract, shared by BOTH stores so they stay
// behavior-twins (InMemoryCatalogStore is the tested stand-in for LibSql).
// Published versions are first-write-wins (Stage 2 doctrine): re-publishing a
// `(name, version)` with identical coordinates is idempotent — only `provenance`
// may be added or updated — while a different sha/ref/relDir/repoUrl/manifest
// must throw. Otherwise the served git-subdir pin silently drifts from the
// release tag it claims to be, and "immutable" stops meaning anything.

import type { StoredPlugin } from "@objectcore/registry-core";

/** Key-order-insensitive canonical form, for manifest deep-equality. */
function canonical(v: unknown): string {
  const sortKeys = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sortKeys);
    if (x && typeof x === "object") {
      return Object.fromEntries(
        Object.keys(x as Record<string, unknown>)
          .sort()
          .map((k) => [k, sortKeys((x as Record<string, unknown>)[k])]),
      );
    }
    return x;
  };
  return JSON.stringify(sortKeys(v));
}

/** Throws unless `incoming` matches the `stored` version row on every immutable
 *  field (provenance excluded — it is the one backfillable/updatable column). */
export function assertVersionImmutable(stored: StoredPlugin, incoming: StoredPlugin): void {
  const drift: string[] = [];
  if (stored.sha !== incoming.sha) drift.push(`sha (${stored.sha} -> ${incoming.sha})`);
  if (stored.ref !== incoming.ref) drift.push(`ref (${stored.ref} -> ${incoming.ref})`);
  if (stored.relDir !== incoming.relDir) drift.push(`relDir (${stored.relDir} -> ${incoming.relDir})`);
  if (stored.repoUrl !== incoming.repoUrl) drift.push(`repoUrl (${stored.repoUrl} -> ${incoming.repoUrl})`);
  if (canonical(stored.manifest) !== canonical(incoming.manifest)) drift.push("manifest");
  if (drift.length) {
    throw new Error(
      `published versions are immutable: "${incoming.manifest.name}@${incoming.version}" already ` +
        `exists with different ${drift.join(", ")} — bump the version instead of re-publishing`,
    );
  }
}
