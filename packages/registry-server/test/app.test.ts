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
  expect(res.headers.get("cache-control")).toBe("public, max-age=60");
});

// ── caching (Cache-Control + ETag) ───────────────────────────────────────────

test("catalog routes carry Cache-Control and a deterministic ETag", async () => {
  const app = createApp({
    source: new MockSource(fixture),
    derive: base,
    channels: () => ({ source: new MockSource(canaryFixture), derive: base }),
  });
  const res = await app.request("/v1/marketplace.json");
  expect(res.headers.get("cache-control")).toBe("public, max-age=60");
  const etag = res.headers.get("etag");
  expect(etag).toMatch(/^"[0-9a-f]{64}"$/); // sha256 of the body — same catalog, same tag
  expect((await app.request("/v1/marketplace.json")).headers.get("etag")).toBe(etag);

  const ch = await app.request("/v1/canary/marketplace.json");
  expect(ch.headers.get("cache-control")).toBe("public, max-age=60");
  expect(ch.headers.get("etag")).toMatch(/^"[0-9a-f]{64}"$/);
  expect(ch.headers.get("etag")).not.toBe(etag); // different catalog, different tag
});

test("If-None-Match with the current ETag yields 304; a stale one yields the body", async () => {
  const app = createApp({ source: new MockSource(fixture), derive: base });
  const etag = (await app.request("/v1/marketplace.json")).headers.get("etag")!;

  const cached = await app.request("/v1/marketplace.json", { headers: { "if-none-match": etag } });
  expect(cached.status).toBe(304);
  expect(cached.headers.get("etag")).toBe(etag);

  const stale = await app.request("/v1/marketplace.json", { headers: { "if-none-match": '"deadbeef"' } });
  expect(stale.status).toBe(200);
  const catalog = (await stale.json()) as MarketplaceJson;
  expect(catalog.plugins.map((p) => p.name)).toEqual(["alpha-plugin", "beta-plugin"]);
});

// ── error handling on the seam ───────────────────────────────────────────────

test("a throwing source yields a JSON 500, never Hono's text/plain default", async () => {
  class BrokenSource implements CatalogSource {
    async listPlugins(): Promise<WorkspacePlugin[]> {
      throw new Error("turso blip");
    }
  }
  const app = createApp({ source: new BrokenSource(), derive: base });
  const res = await app.request("/v1/marketplace.json");
  expect(res.status).toBe(500);
  expect(res.headers.get("content-type")).toContain("application/json");
  expect(await res.json()).toEqual({ error: "internal error" }); // no internals leaked
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

test("POST /v1/events rejects an oversized body with 413 before parsing", async () => {
  const events = new InMemoryEventStore();
  const app = createApp({ source: new MockSource(fixture), derive: base, events });
  const res = await postEvent(app, { type: "install", pad: "x".repeat(40 * 1024) });
  expect(res.status).toBe(413);
  expect(await events.count()).toBe(0);
});

test("a wrong-length events token is still a plain 401 (hash-then-compare has no length precondition)", async () => {
  const events = new InMemoryEventStore();
  const app = createApp({ source: new MockSource(fixture), derive: base, events, eventsToken: "s3cret" });
  const res = await postEvent(app, { type: "install" }, { authorization: "Bearer x" });
  expect(res.status).toBe(401);
  expect(await events.count()).toBe(0);
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

test("POST /v1/plugins maps an immutable-version conflict to 409 (identical re-publish stays 201)", async () => {
  const { app } = publishApp();
  expect((await post(app, publishBody, "tok-ok")).status).toBe(201);
  // Idempotent re-publish of identical content: not a conflict.
  expect((await post(app, publishBody, "tok-ok")).status).toBe(201);
  // Same version, different sha: the store's first-write-wins throw surfaces as 409.
  const drifted = await post(app, { ...publishBody, sha: "def5678" }, "tok-ok");
  expect(drifted.status).toBe(409);
  expect(((await drifted.json()) as { error: string }).error).toMatch(/immutable/i);
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

test("POST /v1/plugins rejects `provenance: null` — presence alone must not clear the gate (400)", async () => {
  const { app, store } = publishApp();
  const mcpBody = { ...publishBody, manifest: { ...publishBody.manifest, mcpServers: ".mcp.json" } };
  const res = await post(app, { ...mcpBody, provenance: null }, "tok-ok");
  expect(res.status).toBe(400);
  expect((await store.listLatest("stable")).length).toBe(0);
});

test("POST /v1/plugins binds repoUrl to the token's repository claim (403 on mismatch)", async () => {
  const { app, store } = publishApp();
  const spoofed = await post(app, { ...publishBody, repoUrl: "https://github.com/attacker/other" }, "tok-ok");
  expect(spoofed.status).toBe(403);
  expect((await store.listLatest("stable")).length).toBe(0);

  // Case and a trailing .git are cosmetic, not identity — still the claimed repo.
  const cosmetic = await post(
    app,
    { ...publishBody, repoUrl: "https://github.com/Twofoldtech-Dakota/ObjectCore.git" },
    "tok-ok",
  );
  expect(cosmetic.status).toBe(201);
});

test("POST /v1/plugins rejects an oversized body with 413 before parsing", async () => {
  const { app, store } = publishApp();
  const res = await post(app, { ...publishBody, pad: "x".repeat(600 * 1024) }, "tok-ok");
  expect(res.status).toBe(413);
  expect((await store.listLatest("stable")).length).toBe(0);
});
