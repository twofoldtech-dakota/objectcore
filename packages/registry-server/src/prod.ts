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

async function dbApp(): Promise<Hono> {
  const store = LibSqlCatalogStore.fromEnv();
  await store.migrate(); // idempotent: a fresh Turso DB gets its schema before first serve
  const allowed = new Set(
    (process.env.OBJECTCORE_CHANNELS ?? "stable,canary").split(",").map((s) => s.trim()).filter(Boolean),
  );
  // cache rows ~5s so listPlugins() + pins() in one request hit the DB once.
  const sourceFor = (ch: string) => {
    const src = new RegistryDbSource(store, ch, 5000);
    return { source: src, derive: async () => ({ ...base, ...(await src.pins()) }) };
  };
  const stable = sourceFor(channel);
  console.log(`ObjectCore registry (prod/db) -> :${port} [channel=${channel}, channels=${[...allowed].join(",")}]`);
  return createApp({
    ...stable,
    ready: async () => {
      await store.listLatest(channel); // throws if the DB is unreachable / schema missing
      return true;
    },
    channels: (ch) => (allowed.has(ch) ? sourceFor(ch) : undefined),
  });
}

const app = mode === "file" ? fileApp() : await dbApp();
export default { port, fetch: app.fetch };
