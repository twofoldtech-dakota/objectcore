// Sink adapters. The port is `CatalogSink`. GitFileSink writes the file (now);
// HttpServeSink holds the catalog for the HTTP server (dev loop now, prod at Stage 3).

import { writeFile } from "node:fs/promises";
import type { MarketplaceJson } from "./types";

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
