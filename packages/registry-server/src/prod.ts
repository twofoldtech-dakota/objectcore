// Prod entry for the ObjectCore registry backend (Stage 3). Same createApp + the same
// deriveCatalog seam as the dev loop; the differences are the CatalogSource and that
// the served catalog is SHA-pinned (git-subdir) — required for URL distribution, since
// bare relative-path sources only resolve under Git (AGENTS.md).
//
//   OBJECTCORE_SOURCE=db    (default) — serve from Turso/libSQL via RegistryDbSource;
//                                       pins (shaPin/repoUrl) come from the same rows.
//   OBJECTCORE_SOURCE=file             — break-glass: serve a baked
//                                       dist/marketplace.pinned.json verbatim
//                                       (serving, not a second derivation).

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { RegistryDbSource } from "@objectcore/registry-core";
import { LibSqlCatalogStore } from "@objectcore/registry-db";
import { createApp } from "./app";

const root = join(import.meta.dir, "..", "..", "..");
const cfg = JSON.parse(readFileSync(join(root, "objectcore.config.json"), "utf8"));
const base = { name: cfg.name, owner: cfg.owner, pluginRoot: cfg.pluginRoot, schema: cfg.schema };

const mode = process.env.OBJECTCORE_SOURCE ?? "db";
const channel = process.env.OBJECTCORE_CHANNEL ?? "stable";
const port = Number(process.env.PORT ?? 8080);

function fileApp(): Hono {
  const pinnedPath = process.env.OBJECTCORE_PINNED ?? join(root, "dist", "marketplace.pinned.json");
  const pinned = JSON.parse(readFileSync(pinnedPath, "utf8"));
  const app = new Hono();
  app.get("/v1/marketplace.json", (c) => c.json(pinned));
  app.get("/healthz", (c) => c.json({ ok: true }));
  console.log(`ObjectCore registry (prod/file) -> :${port} [${pinnedPath}]`);
  return app;
}

function dbApp(): Hono {
  // cache rows ~5s so listPlugins() + pins() in one request hit the DB once.
  const source = new RegistryDbSource(LibSqlCatalogStore.fromEnv(), channel, 5000);
  console.log(`ObjectCore registry (prod/db) -> :${port} [channel=${channel}]`);
  return createApp({ source, derive: async () => ({ ...base, ...(await source.pins()) }) });
}

const app = mode === "file" ? fileApp() : dbApp();
export default { port, fetch: app.fetch };
