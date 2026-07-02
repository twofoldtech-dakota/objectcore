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
      // A broken manifest fails fast (unlike a missing one), but names the file —
      // a bare SyntaxError never says which of the plugins is at fault.
      let manifest: PluginManifest;
      try {
        manifest = JSON.parse(raw) as PluginManifest;
      } catch (e) {
        throw new Error(`invalid JSON in ${manifestPath}: ${(e as Error).message}`);
      }
      plugins.push({ manifest, dir, relDir: name });
    }
    return plugins;
  }
}

/** A published plugin version as the registry DB stores it: the raw manifest plus
 *  the pin coordinates (`sha`/`ref`/`repoUrl`). The DB never stores finished catalog
 *  entries — `deriveCatalog` still shapes them at read time, so there is one
 *  derivation path (AGENTS.md). */
export interface StoredPlugin {
  manifest: PluginManifest;
  /** Source path under pluginRoot, e.g. "hello-objectcore". */
  relDir: string;
  version: string;
  /** Release commit sha backing the git-subdir pin. */
  sha: string;
  /** `releaseTag(name, version)`, e.g. "hello-objectcore--v0.1.0". */
  ref: string;
  /** Repo URL backing the git-subdir pin. */
  repoUrl: string;
  /** Build attestation reference, if any (the MCP managed-credential gate). */
  provenance?: unknown;
}

/** The registry DB port — an engine-agnostic store of published plugin versions.
 *  Reads feed `deriveCatalog` (via {@link RegistryDbSource}); writes are fed the
 *  pinned catalog (via `RegistryDbSink`). The concrete adapter (libSQL/Turso) lives
 *  in `@objectcore/registry-db` so this core package stays dependency-free. */
export interface CatalogStore {
  /** Current published version of every plugin on a channel (default "stable"). */
  listLatest(channel?: string): Promise<StoredPlugin[]>;
  /** Published versions are immutable (Stage 2 doctrine): a `(name, version)` row is
   *  first-write-wins. Re-publishing identical coordinates is idempotent, except
   *  `provenance` may be added or updated; `provenance: undefined` means "preserve
   *  any existing value" (there is no legitimate clear-provenance flow). A different
   *  sha/ref/relDir/repoUrl/manifest for an existing version MUST throw. */
  upsertVersion(p: StoredPlugin): Promise<void>;
  setChannel(channel: string, name: string, version: string): Promise<void>;
}

/** Reads published plugins from the registry DB (Stage 3). The same `CatalogSource`
 *  contract as `GitWorkspaceSource`, so the swap is one line behind `createApp`.
 *  Constructed WITHOUT a store it preserves the pre-Stage-3 throwing behaviour. */
export class RegistryDbSource implements CatalogSource {
  private cache: { at: number; rows: StoredPlugin[] } | null = null;

  constructor(
    private readonly store?: CatalogStore,
    private readonly channel = "stable",
    /** ms to cache listLatest so listPlugins()+pins() in one request hit the DB
     *  once. 0 disables (tests). */
    private readonly cacheTtlMs = 0,
  ) {}

  private async rows(): Promise<StoredPlugin[]> {
    if (!this.store) {
      throw new Error(
        "RegistryDbSource is not wired yet. Operate GitWorkspaceSource until a Stage 3 " +
          "backend trigger fires (search/telemetry, dynamic catalogs, >~50 plugins, or OIDC publishing).",
      );
    }
    const now = Date.now();
    if (this.cache && now - this.cache.at < this.cacheTtlMs) return this.cache.rows;
    try {
      const rows = await this.store.listLatest(this.channel);
      this.cache = { at: now, rows };
      return rows;
    } catch (err) {
      // Stale-if-error: the seam URL must ride out transient store blips, so a
      // last-known-good snapshot beats a 500. /readyz still reports the true DB
      // state via its own listLatest call, so health checks stay honest.
      if (this.cache) {
        console.error(
          `RegistryDbSource: store read failed; serving last-known-good catalog (${(err as Error).message})`,
        );
        return this.cache.rows;
      }
      throw err;
    }
  }

  async listPlugins(): Promise<WorkspacePlugin[]> {
    // deriveCatalog reads only manifest + relDir; `dir` is unused in the serving path
    // (disk validation runs at CI/publish time on a real checkout, never here).
    return (await this.rows()).map((r) => ({ manifest: r.manifest, dir: "", relDir: r.relDir }));
  }

  /** The `shaPin` + `repoUrl` for `deriveCatalog`, built from the SAME rows that
   *  `listPlugins` serves — so the served catalog is the immutable git-subdir form.
   *  Fails closed on rows spanning more than one repoUrl: `deriveCatalog` pins
   *  against a single repoUrl, so serving would mispin every other repo's plugins. */
  async pins(): Promise<{ shaPin: Record<string, string>; repoUrl?: string }> {
    const rows = await this.rows();
    const urls = new Set(rows.map((r) => r.repoUrl));
    if (urls.size > 1) {
      throw new Error(
        `catalog spans multiple repoUrls (${[...urls].join(", ")}) — deriveCatalog pins against ` +
          "one repoUrl; refusing to serve mispinned entries (surfaces as 500s on /v1/marketplace.json).",
      );
    }
    return {
      shaPin: Object.fromEntries(rows.map((r) => [r.manifest.name, r.sha])),
      repoUrl: rows[0]?.repoUrl,
    };
  }
}
