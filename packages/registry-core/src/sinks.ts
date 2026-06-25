// Sink adapters. The port is `CatalogSink`. GitFileSink writes the file (now);
// HttpServeSink holds the catalog for the HTTP server (dev loop now, prod at Stage 3);
// RegistryDbSink ingests the published (pinned) catalog into the registry DB.

import { writeFile } from "node:fs/promises";
import type { MarketplaceEntry, MarketplaceJson, PluginManifest } from "./types";
import type { CatalogStore, StoredPlugin } from "./sources";

export interface CatalogSink {
  publish(catalog: MarketplaceJson): Promise<void>;
}

/** Writes marketplace.json to the repo. OPERATE now. */
export class GitFileSink implements CatalogSink {
  constructor(private readonly path: string) {}

  async publish(catalog: MarketplaceJson): Promise<void> {
    await writeFile(this.path, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  }
}

/** Holds the latest catalog in memory for the HTTP adapter to serve. */
export class HttpServeSink implements CatalogSink {
  private current: MarketplaceJson | null = null;

  async publish(catalog: MarketplaceJson): Promise<void> {
    this.current = catalog;
  }

  get(): MarketplaceJson | null {
    return this.current;
  }
}

/** Manifest fields `deriveCatalog` copies into a catalog entry — the round-trip set
 *  RegistryDbSink reconstructs a manifest from. Mirrors the `copyIf` list in derive.ts. */
const ENTRY_MANIFEST_FIELDS = [
  "displayName",
  "description",
  "version",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "category",
] as const;

/** Ingests a PINNED catalog (a `deriveCatalog` output with `shaPin`) into the
 *  registry DB. Consuming the derivation — not raw manifests — is what keeps the DB
 *  from diverging from the published artifact: there is still ONE derivation path.
 *  Refuses bare-path entries, because only versioned, SHA-pinned plugins are
 *  distributable over the registry URL (AGENTS.md: migrate off relative paths). */
export class RegistryDbSink implements CatalogSink {
  constructor(
    private readonly store: CatalogStore,
    private readonly channel = "stable",
  ) {}

  async publish(catalog: MarketplaceJson): Promise<void> {
    const base = (catalog.metadata?.pluginRoot ?? "./plugins")
      .replace(/^\.\//, "")
      .replace(/\/+$/, "");

    for (const e of catalog.plugins) {
      const src = e.source;
      if (typeof src === "string" || src.source !== "git-subdir") {
        throw new Error(
          `RegistryDbSink expects pinned git-subdir entries; "${e.name}" is not pinned. ` +
            "Only versioned, SHA-pinned plugins can be published to the registry.",
        );
      }
      if (!e.version || !src.ref || !src.sha) {
        throw new Error(
          `RegistryDbSink: "${e.name}" is missing version/ref/sha — cannot publish an unpinned entry.`,
        );
      }
      const relDir = src.path.startsWith(`${base}/`) ? src.path.slice(base.length + 1) : src.path;

      const manifest = { name: e.name } as PluginManifest;
      const m = manifest as unknown as Record<string, unknown>;
      for (const k of ENTRY_MANIFEST_FIELDS) {
        const v = (e as MarketplaceEntry)[k];
        if (v !== undefined) m[k] = v;
      }

      const stored: StoredPlugin = {
        manifest,
        relDir,
        version: e.version,
        sha: src.sha,
        ref: src.ref,
        repoUrl: src.url,
      };
      await this.store.upsertVersion(stored);
      await this.store.setChannel(this.channel, e.name, e.version);
    }
  }
}
