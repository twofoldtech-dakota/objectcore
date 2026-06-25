// ObjectCore — registry-core domain types.
// These mirror the verified Claude Code plugin/marketplace spec (code.claude.com, 2026).

/** Plugin manifest: `.claude-plugin/plugin.json`. Only `name` is required. */
export interface PluginManifest {
  /** kebab-case, required. Drives component namespacing (e.g. `plugin-forge:scaffold`). */
  name: string;
  displayName?: string;
  version?: string;
  description?: string;
  author?: { name: string; email?: string; url?: string };
  homepage?: string;
  /** MUST be a string per spec (an object is a hard load error). */
  repository?: string;
  /** SPDX identifier. */
  license?: string;
  /** MUST be an array per spec (a string is a hard load error). */
  keywords?: string[];
  category?: string;
  /** Component-path overrides (optional; auto-discovered if omitted). */
  skills?: string;
  commands?: string;
  agents?: string;
  hooks?: string;
  mcpServers?: string;
  /** Plugin dependencies (Claude Code v2.1.110+). Node semver ranges. */
  dependencies?: Array<
    string | { name: string; version?: string; marketplace?: string }
  >;
}

/** Plugin source types as they appear in a marketplace entry. */
export type PluginSource =
  | string // relative path (Git-native), e.g. "formatter" under pluginRoot, or "./plugins/formatter"
  | { source: "github"; repo: string; ref?: string; sha?: string }
  | { source: "url"; url: string; ref?: string; sha?: string }
  | { source: "git-subdir"; url: string; path: string; ref?: string; sha?: string }
  | { source: "npm"; package: string; version?: string; registry?: string };

/** A single catalog entry inside marketplace.json. */
export interface MarketplaceEntry {
  name: string;
  source: PluginSource;
  displayName?: string;
  description?: string;
  version?: string;
  author?: PluginManifest["author"];
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  category?: string;
  strict?: boolean;
}

/** `.claude-plugin/marketplace.json` — the catalog Claude Code consumes. */
export interface MarketplaceJson {
  name: string;
  owner: { name: string; email?: string };
  plugins: MarketplaceEntry[];
  $schema?: string;
  metadata?: { pluginRoot?: string; description?: string; version?: string };
  allowCrossMarketplaceDependenciesOn?: string[];
}

/** A plugin discovered in the workspace: its manifest plus where it lives. */
export interface WorkspacePlugin {
  manifest: PluginManifest;
  /** Absolute path to the plugin directory. */
  dir: string;
  /** Path relative to pluginRoot, e.g. "formatter". Becomes the source under pluginRoot. */
  relDir: string;
}
