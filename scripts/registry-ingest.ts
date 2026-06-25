// `bun run registry:ingest [path]` — push the published (SHA-pinned) catalog into the
// registry DB so the backend serves it live, with no redeploy. Consumes
// dist/marketplace.pinned.json (the release artifact) and feeds it to RegistryDbSink —
// the SAME deriveCatalog output, so the DB can never diverge from the artifact.
//
// Gated on DATABASE_URL: with no DB configured it logs and exits 0 — the same posture
// as the activation-eval API-key gate (no silent caps, but a green no-op).

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { RegistryDbSink, type MarketplaceJson } from "@objectcore/registry-core";
import { LibSqlCatalogStore } from "@objectcore/registry-db";

const root = join(import.meta.dir, "..");
const channel = process.env.OBJECTCORE_CHANNEL ?? "stable";
const pinnedPath = process.argv[2] ?? join(root, "dist", "marketplace.pinned.json");

if (!process.env.DATABASE_URL) {
  console.log("• registry:ingest skipped — DATABASE_URL is not set (no registry DB configured).");
  process.exit(0);
}

const catalog = JSON.parse(readFileSync(pinnedPath, "utf8")) as MarketplaceJson;
const store = LibSqlCatalogStore.fromEnv();
await store.migrate();
await new RegistryDbSink(store, channel).publish(catalog);
console.log(
  `✓ ingested ${catalog.plugins.length} plugin(s) into channel "${channel}" from ${pinnedPath}`,
);
