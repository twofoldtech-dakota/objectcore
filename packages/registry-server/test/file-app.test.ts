// Break-glass file mode (OBJECTCORE_SOURCE=file). Fly's health check points at
// /readyz — a file-mode instance without it is marked unhealthy and never routed,
// which is exactly when the break-glass path is needed. Locks the three routes.

import { test, expect } from "bun:test";
import { fileApp } from "../src/file-app";

const pinned = {
  name: "objectcore",
  owner: { name: "twofoldtech-dakota" },
  plugins: [
    {
      name: "alpha-plugin",
      version: "0.1.0",
      source: { source: "git-subdir", url: "https://github.com/o/r", path: "plugins/alpha-plugin", sha: "a".repeat(40), ref: "alpha-plugin--v0.1.0" },
    },
  ],
};

test("fileApp serves the baked pinned catalog verbatim, with cache headers", async () => {
  const app = fileApp(pinned);
  const res = await app.request("/v1/marketplace.json");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(pinned);
  expect(res.headers.get("cache-control")).toBe("public, max-age=60");
});

test("fileApp answers /healthz and /readyz (booted == ready: the file parsed at boot)", async () => {
  const app = fileApp(pinned);
  expect(await (await app.request("/healthz")).json()).toEqual({ ok: true });
  const ready = await app.request("/readyz");
  expect(ready.status).toBe(200);
  expect(await ready.json()).toEqual({ ready: true });
});
