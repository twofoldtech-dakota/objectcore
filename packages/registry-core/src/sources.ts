// Source adapters. The port is `CatalogSource`. Today we operate the Git adapter;
// the DB adapter is a tested stub that lights up at the Stage 3 backend trigger.

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { PluginManifest, WorkspacePlugin } from "./types";

export interface CatalogSource {
  listPlugins(): Promise<WorkspacePlugin[]>;
}

/** Reads ./plugins/<name>/.claude-plugin/plugin.json from disk. OPERATE now. */
export class GitWorkspaceSource implements CatalogSource {
  constructor(private readonly pluginsDir: string) {}

  async listPlugins(): Promise<WorkspacePlugin[]> {
    let names: string[];
    try {
      names = await readdir(this.pluginsDir);
    } catch {
      return [];
    }

    const plugins: WorkspacePlugin[] = [];
    for (const name of names.sort()) {
      if (name.startsWith(".")) continue;
      const dir = join(this.pluginsDir, name);
      try {
        if (!(await stat(dir)).isDirectory()) continue;
      } catch {
        continue;
      }
      const manifestPath = join(dir, ".claude-plugin", "plugin.json");
      let raw: string;
      try {
        raw = await readFile(manifestPath, "utf8");
      } catch {
        // No manifest -> not a plugin (Stage 1 can auto-derive name from dir).
        continue;
      }
      const manifest = JSON.parse(raw) as PluginManifest;
      plugins.push({ manifest, dir, relDir: name });
    }
    return plugins;
  }
}

/** Reads from the registry DB. STUB — same contract, wired at Stage 3. */
export class RegistryDbSource implements CatalogSource {
  async listPlugins(): Promise<WorkspacePlugin[]> {
    throw new Error(
      "RegistryDbSource is not wired yet. Operate GitWorkspaceSource until a Stage 3 " +
        "backend trigger fires (search/telemetry, dynamic catalogs, >~50 plugins, or OIDC publishing).",
    );
  }
}
