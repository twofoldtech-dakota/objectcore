// The invariant. Pure: WorkspacePlugin[] -> MarketplaceJson. No I/O.
// CI runs this reading the filesystem (now). The backend runs the SAME function
// reading the DB (Stage 3). That is what makes the backend a relocation, not a rewrite.

import type {
  MarketplaceJson,
  MarketplaceEntry,
  WorkspacePlugin,
} from "./types";

export interface DeriveOpts {
  name: string;
  owner: { name: string; email?: string };
  /** e.g. "./plugins" — when set, entry sources are bare names ("formatter"). */
  pluginRoot?: string;
  schema?: string;
  /** Stage 2: plugin name -> commit sha, to SHA-pin catalog entries. */
  shaPin?: Record<string, string>;
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

  const entries: MarketplaceEntry[] = plugins
    .slice()
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name))
    .map((p) => {
      const m = p.manifest;
      const entry: MarketplaceEntry = {
        name: m.name,
        // Git-native source. With pluginRoot set, the source is the bare relDir.
        source: usePluginRoot ? p.relDir : `./${p.relDir}`,
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
