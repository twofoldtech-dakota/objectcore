// The invariant. Pure: WorkspacePlugin[] -> MarketplaceJson. No I/O.
// CI runs this reading the filesystem (now). The backend runs the SAME function
// reading the DB (Stage 3). That is what makes the backend a relocation, not a rewrite.

import type {
  MarketplaceJson,
  MarketplaceEntry,
  PluginSource,
  WorkspacePlugin,
} from "./types";
import { releaseTag } from "./tags";

export interface DeriveOpts {
  name: string;
  owner: { name: string; email?: string };
  /** e.g. "./plugins" — when set, entry sources are bare names ("formatter"). */
  pluginRoot?: string;
  schema?: string;
  /**
   * Stage 2 (publish): plugin name -> commit sha. A pinned entry's `source`
   * becomes an immutable `git-subdir` pointer (sha + `{plugin}--v{semver}` ref)
   * instead of the bare relative path. Requires {@link DeriveOpts.repoUrl}.
   * Omit it and derivation is byte-identical to the dev catalog — which is why
   * the committed marketplace.json (derived WITHOUT pins) stays stable.
   */
  shaPin?: Record<string, string>;
  /** Stage 2 (publish): repo URL backing git-subdir pins. Required when shaPin pins an entry. */
  repoUrl?: string;
}

const copyIf = <K extends keyof MarketplaceEntry>(
  src: Partial<Record<K, MarketplaceEntry[K]>>,
  dst: MarketplaceEntry,
  keys: K[],
): void => {
  for (const k of keys) {
    if (src[k] !== undefined) dst[k] = src[k] as MarketplaceEntry[K];
  }
};

export function deriveCatalog(
  plugins: WorkspacePlugin[],
  opts: DeriveOpts,
): MarketplaceJson {
  const usePluginRoot = Boolean(opts.pluginRoot);
  // pluginRoot "./plugins" -> repo-relative base "plugins" for git-subdir paths.
  const subdirBase = (opts.pluginRoot ?? "./plugins").replace(/^\.\//, "").replace(/\/+$/, "");

  const entries: MarketplaceEntry[] = plugins
    .slice()
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name))
    .map((p) => {
      const m = p.manifest;
      const entry: MarketplaceEntry = {
        name: m.name,
        // Git-native source. With pluginRoot set, the source is the bare relDir.
        // A SHA-pin (publish only) upgrades it to an immutable git-subdir pointer.
        source: pinnedSource(m.name, p.relDir, usePluginRoot, subdirBase, m.version, opts),
      };
      copyIf(m, entry, [
        "displayName",
        "description",
        "version",
        "author",
        "homepage",
        "repository",
        "license",
        "keywords",
        "category",
      ]);
      return entry;
    });

  const out: MarketplaceJson = {
    name: opts.name,
    owner: opts.owner,
    plugins: entries,
  };
  if (opts.schema) out.$schema = opts.schema;
  if (opts.pluginRoot) out.metadata = { pluginRoot: opts.pluginRoot };
  return out;
}

/** Resolve an entry's `source`: bare relative path (dev), or an immutable
 *  git-subdir pin (publish, when `shaPin[name]` is set). Pure. */
function pinnedSource(
  name: string,
  relDir: string,
  usePluginRoot: boolean,
  subdirBase: string,
  version: string | undefined,
  opts: DeriveOpts,
): PluginSource {
  const sha = opts.shaPin?.[name];
  if (!sha) return usePluginRoot ? relDir : `./${relDir}`;
  if (!opts.repoUrl) {
    throw new Error(
      `shaPin set for "${name}" but opts.repoUrl is missing — a git-subdir pin needs the repo URL`,
    );
  }
  const source: Extract<PluginSource, { source: "git-subdir" }> = {
    source: "git-subdir",
    url: opts.repoUrl,
    path: `${subdirBase}/${relDir}`,
    sha,
  };
  if (version) source.ref = releaseTag(name, version);
  return source;
}
