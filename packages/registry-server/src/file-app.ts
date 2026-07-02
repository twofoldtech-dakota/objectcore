// Break-glass file mode (OBJECTCORE_SOURCE=file): serve a baked pinned catalog
// verbatim — serving, not a second derivation. Extracted from prod.ts so the route
// set is unit-testable; the readFileSync + JSON.parse stay at the boot call site,
// which means booted == ready: /readyz answers without a backing dependency (Fly's
// health check points at /readyz, not /healthz, so file mode must expose it too).

import { Hono } from "hono";
import { CATALOG_CACHE_CONTROL } from "./app";

export function fileApp(pinned: unknown): Hono {
  const app = new Hono();
  app.get("/v1/marketplace.json", (c) => {
    c.header("cache-control", CATALOG_CACHE_CONTROL);
    return c.json(pinned as object);
  });
  app.get("/healthz", (c) => c.json({ ok: true }));
  // The pinned file was read and parsed at boot — there is nothing left to check.
  app.get("/readyz", (c) => c.json({ ready: true }));
  return app;
}
