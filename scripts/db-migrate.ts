// `bun run db:migrate` — apply the registry DB schema (idempotent). Gated on
// DATABASE_URL: a green no-op when no DB is configured.

import { LibSqlCatalogStore } from "@objectcore/registry-db";

if (!process.env.DATABASE_URL) {
  console.log("• db:migrate skipped — DATABASE_URL is not set.");
  process.exit(0);
}

const store = LibSqlCatalogStore.fromEnv();
await store.migrate();
console.log("✓ registry DB schema applied.");
