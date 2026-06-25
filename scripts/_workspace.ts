// Shared wiring for the repo's catalog CLIs (build-marketplace, check-catalog,
// eval, forge-scaffold). One place turns objectcore.config.json + the plugins dir
// into the (plugins, catalog) pair, so every script derives through the SAME
// deriveCatalog call with the SAME opts — the "single derivation path" doctrine
// made literal at the wiring level. Not a runnable script (underscore prefix).

import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  GitWorkspaceSource,
  deriveCatalog,
  type DeriveOpts,
  type MarketplaceJson,
  type WorkspacePlugin,
} from "@objectcore/registry-core";

/** Shape of objectcore.config.json — the single source of marketplace identity. */
export interface ObjectCoreConfig {
  name: string;
  owner: { name: string; email?: string };
  pluginRoot?: string;
  schema?: string;
  registryUrl?: string;
}

export function loadConfig(root: string): ObjectCoreConfig {
  return JSON.parse(readFileSync(join(root, "objectcore.config.json"), "utf8"));
}

export function deriveOptsFromConfig(cfg: ObjectCoreConfig): DeriveOpts {
  return { name: cfg.name, owner: cfg.owner, pluginRoot: cfg.pluginRoot, schema: cfg.schema };
}

export interface Workspace {
  root: string;
  cfg: ObjectCoreConfig;
  pluginsDir: string;
  plugins: WorkspacePlugin[];
  catalog: MarketplaceJson;
}

/** Read config, list plugins from disk (Git source), and derive the catalog. */
export async function loadWorkspace(root: string): Promise<Workspace> {
  const cfg = loadConfig(root);
  const pluginsDir = join(root, "plugins");
  const plugins = await new GitWorkspaceSource(pluginsDir).listPlugins();
  const catalog = deriveCatalog(plugins, deriveOptsFromConfig(cfg));
  return { root, cfg, pluginsDir, plugins, catalog };
}
