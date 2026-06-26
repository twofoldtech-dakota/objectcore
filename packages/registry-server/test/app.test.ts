import { test, expect } from "bun:test";
import {
  validateAll,
  type CatalogSource,
  type DeriveOpts,
  type MarketplaceJson,
  type WorkspacePlugin,
} from "@objectcore/registry-core";
import { MockOidcVerifier, type OidcClaims, type PublishPolicy } from "@objectcore/registry-core";
import { InMemoryEventStore, InMemoryCatalogStore } from "@objectcore/registry-db";
import { createApp } from "../src/app";

function postEvent(app: ReturnType<typeof createApp>, body: unknown, headers: Record<string, string> = {}) {
  return app.request("/v1/events", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

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

test("POST /v1/events ingests a valid event (202) when a sink is wired", async () => {
  const events = new InMemoryEventStore(() => "2026-01-01T00:00:00Z");
  const app = createApp({ source: new MockSource(fixture), derive: base, events });
  const res = await postEvent(app, { type: "install", plugin: "alpha-plugin" });
  expect(res.status).toBe(202);
  expect(await res.json()).toEqual({ ok: true });
  expect(await events.count()).toBe(1);
});

test("POST /v1/events rejects a malformed event with 400 and records nothing", async () => {
  const events = new InMemoryEventStore();
  const app = createApp({ source: new MockSource(fixture), derive: base, events });
  const res = await postEvent(app, { type: "nope" });
  expect(res.status).toBe(400);
  expect(await events.count()).toBe(0);
});

test("POST /v1/events is absent (404) when no sink is wired", async () => {
  const app = createApp({ source: new MockSource(fixture), derive: base });
  const res = await postEvent(app, { type: "install" });
  expect(res.status).toBe(404);
});

test("POST /v1/events enforces the shared-secret token when eventsToken is set", async () => {
  const events = new InMemoryEventStore();
  const app = createApp({ source: new MockSource(fixture), derive: base, events, eventsToken: "s3cret" });

  const noAuth = await postEvent(app, { type: "install" });
  expect(noAuth.status).toBe(401);
  expect(await events.count()).toBe(0);

  const withAuth = await postEvent(app, { type: "install" }, { authorization: "Bearer s3cret" });
  expect(withAuth.status).toBe(202);
  expect(await events.count()).toBe(1);
});

test("the marketplace seam still serves with a telemetry sink wired", async () => {
  const app = createApp({ source: new MockSource(fixture), derive: base, events: new InMemoryEventStore() });
  const catalog = (await (await app.request("/v1/marketplace.json")).json()) as MarketplaceJson;
  expect(catalog.plugins.map((p) => p.name)).toEqual(["alpha-plugin", "beta-plugin"]);
});

test("GET /v1/events/stats returns aggregates with the token, 401 without/with no token", async () => {
  const events = new InMemoryEventStore(() => "2026-01-01T00:00:00Z");
  await events.record({ type: "install", plugin: "alpha-plugin" });
  await events.record({ type: "activate", plugin: "alpha-plugin" });

  // no token configured -> the read is closed
  const closed = createApp({ source: new MockSource(fixture), derive: base, events });
  expect((await closed.request("/v1/events/stats")).status).toBe(401);

  const app = createApp({ source: new MockSource(fixture), derive: base, events, eventsToken: "s3cret" });
  expect((await app.request("/v1/events/stats")).status).toBe(401); // missing auth
  const ok = await app.request("/v1/events/stats", { headers: { authorization: "Bearer s3cret" } });
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({
    total: 2,
    byType: { install: 1, activate: 1 },
    byPlugin: { "alpha-plugin": 2 },
  });
});

// ── OIDC publish (POST /v1/plugins) ────────────────────────────────────────────

const policy: PublishPolicy = {
  issuer: "https://token.actions.githubusercontent.com",
  audience: "objectcore-registry",
  allowedRepositories: ["twofoldtech-dakota/objectcore"],
};
const goodClaims: OidcClaims = { iss: policy.issuer, aud: policy.audience, repository: "twofoldtech-dakota/objectcore" };
const publishBody = {
  manifest: { name: "hello-objectcore", version: "0.1.0", description: "Demo", keywords: ["demo"] },
  relDir: "hello-objectcore",
  version: "0.1.0",
  sha: "abc1234",
  repoUrl: "https://github.com/twofoldtech-dakota/objectcore",
};

function publishApp(store = new InMemoryCatalogStore(), fixture: Record<string, OidcClaims> = { "tok-ok": goodClaims }) {
  const app = createApp({
    source: new MockSource([]),
    derive: base,
    publish: { verifier: new MockOidcVerifier(fixture), policy, store },
  });
  return { app, store };
}

function post(app: ReturnType<typeof createApp>, body: unknown, token?: string) {
  return app.request("/v1/plugins", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

test("POST /v1/plugins publishes a valid request (201) and writes it to the store", async () => {
  const { app, store } = publishApp();
  const res = await post(app, publishBody, "tok-ok");
  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({ ok: true, name: "hello-objectcore", version: "0.1.0", ref: "hello-objectcore--v0.1.0" });
  const rows = await store.listLatest("stable");
  expect(rows.map((r) => r.manifest.name)).toEqual(["hello-objectcore"]);
  expect(rows[0].ref).toBe("hello-objectcore--v0.1.0");
});

test("POST /v1/plugins is absent (404) when publish is not configured", async () => {
  const app = createApp({ source: new MockSource([]), derive: base });
  expect((await post(app, publishBody, "tok-ok")).status).toBe(404);
});

test("POST /v1/plugins rejects a missing/invalid token (401)", async () => {
  const { app } = publishApp();
  expect((await post(app, publishBody)).status).toBe(401); // no bearer
  expect((await post(app, publishBody, "bogus")).status).toBe(401); // verifier throws
});

test("POST /v1/plugins rejects a token from a disallowed repo (403)", async () => {
  const { app } = publishApp(new InMemoryCatalogStore(), {
    "tok-fork": { ...goodClaims, repository: "attacker/fork" },
  });
  expect((await post(app, publishBody, "tok-fork")).status).toBe(403);
});

test("POST /v1/plugins rejects a malformed body (400)", async () => {
  const { app, store } = publishApp();
  expect((await post(app, { ...publishBody, version: "nope" }, "tok-ok")).status).toBe(400);
  expect((await store.listLatest("stable")).length).toBe(0);
});

test("POST /v1/plugins re-enforces the provenance gate (422 without attestation, 201 with)", async () => {
  const { app, store } = publishApp();
  const mcpBody = { ...publishBody, manifest: { ...publishBody.manifest, mcpServers: ".mcp.json" } };

  expect((await post(app, mcpBody, "tok-ok")).status).toBe(422); // MCP bundle, no provenance
  expect((await store.listLatest("stable")).length).toBe(0);

  const attested = await post(app, { ...mcpBody, provenance: { ref: "att://x" } }, "tok-ok");
  expect(attested.status).toBe(201);
  expect((await store.listLatest("stable"))[0].provenance).toEqual({ ref: "att://x" });
});
