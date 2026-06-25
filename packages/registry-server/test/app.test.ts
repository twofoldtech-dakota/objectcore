import { test, expect } from "bun:test";
import {
  validateAll,
  type CatalogSource,
  type DeriveOpts,
  type MarketplaceJson,
  type WorkspacePlugin,
} from "@objectcore/registry-core";
import { createApp } from "../src/app";

// In-memory source — same shape as MockJudge in @objectcore/eval. Locks the seam
// (route + output contract) so the Git -> DB source swap can't regress it.
class MockSource implements CatalogSource {
  constructor(private readonly plugins: WorkspacePlugin[]) {}
  async listPlugins(): Promise<WorkspacePlugin[]> {
    return this.plugins;
  }
}

const fixture: WorkspacePlugin[] = [
  { manifest: { name: "alpha-plugin", version: "0.1.0", description: "Alpha", keywords: ["x"] }, dir: "", relDir: "alpha-plugin" },
  { manifest: { name: "beta-plugin", version: "1.0.0", description: "Beta" }, dir: "", relDir: "beta-plugin" },
];
const base: DeriveOpts = { name: "objectcore", owner: { name: "Dakota" }, pluginRoot: "./plugins" };

const canaryFixture: WorkspacePlugin[] = [
  { manifest: { name: "gamma-plugin", version: "2.0.0-rc.1", description: "Gamma RC" }, dir: "", relDir: "gamma-plugin" },
];

test("GET /v1/marketplace.json derives a valid catalog from the injected source", async () => {
  const app = createApp({ source: new MockSource(fixture), derive: base });
  const res = await app.request("/v1/marketplace.json");
  expect(res.status).toBe(200);
  const catalog = (await res.json()) as MarketplaceJson;
  expect(catalog.plugins.map((p) => p.name)).toEqual(["alpha-plugin", "beta-plugin"]);
  const errors = (await validateAll(fixture, catalog)).filter((i) => i.level === "error");
  expect(errors).toEqual([]);
});

test("a pinned derive resolver (shaPin+repoUrl) yields git-subdir sources over the URL", async () => {
  const app = createApp({
    source: new MockSource(fixture),
    derive: async () => ({
      ...base,
      repoUrl: "https://github.com/twofoldtech-dakota/objectcore",
      shaPin: { "alpha-plugin": "abc123", "beta-plugin": "def456" },
    }),
  });
  const catalog = (await (await app.request("/v1/marketplace.json")).json()) as MarketplaceJson;
  for (const p of catalog.plugins) {
    expect(typeof p.source === "object" && p.source.source).toBe("git-subdir");
  }
  expect(catalog.plugins[0].source).toMatchObject({
    source: "git-subdir",
    url: "https://github.com/twofoldtech-dakota/objectcore",
    path: "plugins/alpha-plugin",
    sha: "abc123",
    ref: "alpha-plugin--v0.1.0",
  });
});

test("GET /v1/search filters the derived catalog", async () => {
  const app = createApp({ source: new MockSource(fixture), derive: base });
  const res = await app.request("/v1/search?q=alpha");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { count: number; plugins: { name: string }[] };
  expect(body.plugins.map((p) => p.name)).toEqual(["alpha-plugin"]);
});

test("GET /healthz", async () => {
  const app = createApp({ source: new MockSource([]), derive: base });
  const res = await app.request("/healthz");
  expect(await res.json()).toEqual({ ok: true });
});

test("GET /readyz returns 200 when ready() resolves true", async () => {
  const app = createApp({ source: new MockSource([]), derive: base, ready: async () => true });
  const res = await app.request("/readyz");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ready: true });
});

test("GET /readyz returns 503 when ready() throws", async () => {
  const app = createApp({
    source: new MockSource([]),
    derive: base,
    ready: async () => { throw new Error("db down"); },
  });
  const res = await app.request("/readyz");
  expect(res.status).toBe(503);
});

test("GET /readyz defaults to ready when no checker is wired", async () => {
  const app = createApp({ source: new MockSource([]), derive: base });
  const res = await app.request("/readyz");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ready: true });
});

test("GET /v1/:channel/marketplace.json serves the resolved channel", async () => {
  const app = createApp({
    source: new MockSource(fixture),
    derive: base,
    channels: (ch) =>
      ch === "canary" ? { source: new MockSource(canaryFixture), derive: base } : undefined,
  });
  const res = await app.request("/v1/canary/marketplace.json");
  expect(res.status).toBe(200);
  const catalog = (await res.json()) as MarketplaceJson;
  expect(catalog.plugins.map((p) => p.name)).toEqual(["gamma-plugin"]);
});

test("the bare /v1/marketplace.json seam still serves stable when channels is set", async () => {
  const app = createApp({
    source: new MockSource(fixture),
    derive: base,
    channels: () => ({ source: new MockSource(canaryFixture), derive: base }),
  });
  const catalog = (await (await app.request("/v1/marketplace.json")).json()) as MarketplaceJson;
  expect(catalog.plugins.map((p) => p.name)).toEqual(["alpha-plugin", "beta-plugin"]);
});

test("an unknown channel 404s", async () => {
  const app = createApp({
    source: new MockSource(fixture),
    derive: base,
    channels: () => undefined,
  });
  const res = await app.request("/v1/nope/marketplace.json");
  expect(res.status).toBe(404);
});
