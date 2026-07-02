import { createHash, timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  deriveCatalog,
  searchCatalog,
  parseEvent,
  parsePublish,
  authorizePublish,
  repoUrlMatchesClaim,
  toStoredPlugin,
  type CatalogSource,
  type CatalogStore,
  type DeriveOpts,
  type EventSink,
  type OidcVerifier,
  type PublishPolicy,
} from "@objectcore/registry-core";
import { requiresProvenance } from "@objectcore/release";

/** The catalog only changes on publish — let Fly's proxy / CDNs / pollers cache it. */
export const CATALOG_CACHE_CONTROL = "public, max-age=60";

/** Body-size ceilings, enforced before any parse: telemetry can be an open (tokenless)
 *  write path and publish carries a whole manifest + provenance blob. */
const MAX_EVENT_BODY_BYTES = 32 * 1024;
const MAX_PUBLISH_BODY_BYTES = 512 * 1024;

/** Deterministic ETag: sha256 of the exact JSON bytes served. */
function etagOf(body: string): string {
  return `"${createHash("sha256").update(body).digest("hex")}"`;
}

/** Serve a catalog payload with Cache-Control + ETag, honoring If-None-Match so
 *  pollers get 304s instead of a re-derived body. The bytes are the same
 *  JSON.stringify Hono's c.json would emit — the seam's contract is unchanged. */
function catalogJson(c: Context, payload: unknown): Response {
  const body = JSON.stringify(payload);
  const etag = etagOf(body);
  c.header("cache-control", CATALOG_CACHE_CONTROL);
  c.header("etag", etag);
  const inm = c.req.header("if-none-match");
  if (inm && (inm === "*" || inm.split(",").map((s) => s.trim()).includes(etag))) {
    return c.body(null, 304);
  }
  return c.body(body, 200, { "content-type": "application/json" });
}

/** Read a JSON body with a hard byte ceiling (Content-Length when declared, then the
 *  measured bytes) — 413 before any bytes reach a parser or the DB. */
async function readJsonBounded(
  c: Context,
  maxBytes: number,
): Promise<{ ok: true; body: unknown } | { ok: false; status: 400 | 413; error: string }> {
  const declared = Number(c.req.header("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, status: 413, error: `body exceeds ${maxBytes} bytes` };
  }
  const raw = await c.req.arrayBuffer();
  if (raw.byteLength > maxBytes) {
    return { ok: false, status: 413, error: `body exceeds ${maxBytes} bytes` };
  }
  try {
    return { ok: true, body: JSON.parse(new TextDecoder().decode(raw)) };
  } catch {
    return { ok: false, status: 400, error: "invalid JSON body" };
  }
}

/** Constant-time bearer check: sha256 both sides, then timingSafeEqual — hashing
 *  first makes the compare length-independent (no length oracle) and leaks nothing
 *  about the shared secret. */
function bearerMatches(header: string | undefined, token: string): boolean {
  const a = createHash("sha256").update(header ?? "").digest();
  const b = createHash("sha256").update(`Bearer ${token}`).digest();
  return timingSafeEqual(a, b);
}

export interface ServerOpts {
  /** Where plugins come from. Git off disk (dev) or the registry DB (Stage 3 prod).
   *  Injecting it is what makes the source swap a one-line change. */
  source: CatalogSource;
  /** Derive options, or a resolver that builds them per request — the DB path uses
   *  the resolver to attach `shaPin`/`repoUrl` from the same rows it serves. */
  derive: DeriveOpts | (() => DeriveOpts | Promise<DeriveOpts>);
  /** Optional readiness probe: returns true when the backing dependency (e.g. the
   *  registry DB) is reachable. Wired in prod; omitted in dev/tests defaults ready. */
  ready?: () => Promise<boolean>;
  /** Optional: resolve a per-channel (source, derive) pair. When provided,
   *  GET /v1/:channel/marketplace.json serves that channel. Returning undefined
   *  for an unknown channel yields a 404. `/v1/marketplace.json` is unaffected. */
  channels?: (channel: string) =>
    | { source: CatalogSource; derive: DeriveOpts | (() => DeriveOpts | Promise<DeriveOpts>) }
    | undefined;
  /** Optional telemetry sink. When provided, POST /v1/events ingests events; when
   *  omitted the route is absent (the read seam is unaffected either way). */
  events?: EventSink;
  /** Optional shared secret guarding POST /v1/events. When set, the request must send
   *  a matching `Authorization: Bearer <token>`; when unset, ingestion is open —
   *  the same inert-until-armed posture as deploy.yml / record-history.yml. The
   *  authenticated GET /v1/events/stats read ALWAYS requires it (an open telemetry
   *  read would be a data-exposure surface). */
  eventsToken?: string;
  /** Optional self-service publish (POST /v1/plugins). When provided, the route
   *  verifies an OIDC bearer token, authorizes it against `policy`, re-enforces the
   *  provenance gate, and writes to `store` (the same CatalogStore the server reads).
   *  Absent (404) when omitted — inert until armed in prod.ts. */
  publish?: {
    verifier: OidcVerifier;
    policy: PublishPolicy;
    store: CatalogStore;
  };
}

// The HTTP adapter. Dev-loop server now; the SAME app serves prod at Stage 3 (swap
// the injected CatalogSource Git -> DB). The route and output contract never change —
// that is what makes Stage 3 a relocation, not a rewrite.
export function createApp(opts: ServerOpts): Hono {
  const app = new Hono();

  // The seam must always speak JSON, even on failure — Hono's default is a
  // text/plain 500. Details stay in the log, not the response.
  app.onError((err, c) => {
    console.error(`✗ ${c.req.method} ${c.req.path}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    return c.json({ error: "internal error" }, 500);
  });

  // The ONLY endpoint Claude Code consumes. Stable forever.
  app.get("/v1/marketplace.json", async (c) => {
    const plugins = await opts.source.listPlugins();
    const derive = typeof opts.derive === "function" ? await opts.derive() : opts.derive;
    return catalogJson(c, deriveCatalog(plugins, derive));
  });

  app.get("/v1/search", async (c) => {
    const plugins = await opts.source.listPlugins();
    const derive = typeof opts.derive === "function" ? await opts.derive() : opts.derive;
    const catalog = deriveCatalog(plugins, derive);
    c.header("cache-control", CATALOG_CACHE_CONTROL);
    return c.json(
      searchCatalog(catalog, {
        q: c.req.query("q"),
        keyword: c.req.query("keyword"),
        category: c.req.query("category"),
      }),
    );
  });

  app.get("/healthz", (c) => c.json({ ok: true }));

  app.get("/readyz", async (c) => {
    if (!opts.ready) return c.json({ ready: true });
    try {
      return (await opts.ready())
        ? c.json({ ready: true })
        : c.json({ ready: false }, 503);
    } catch (err) {
      return c.json({ ready: false, error: String(err) }, 503);
    }
  });

  // Telemetry ingestion (additive write path; the marketplace seam is untouched).
  // Registered only when a sink is injected — like channels, the route is absent
  // otherwise. parseEvent (pure, in registry-core) does strict validation; the sink
  // stamps the server-side timestamp.
  if (opts.events) {
    const sink = opts.events;
    app.post("/v1/events", async (c) => {
      if (opts.eventsToken && !bearerMatches(c.req.header("authorization"), opts.eventsToken)) {
        return c.json({ error: "unauthorized" }, 401);
      }
      const read = await readJsonBounded(c, MAX_EVENT_BODY_BYTES);
      if (!read.ok) return c.json({ error: read.error }, read.status);
      const parsed = parseEvent(read.body);
      if (!parsed.ok) return c.json({ error: parsed.error }, 400);
      await sink.record(parsed.event);
      return c.json({ ok: true }, 202);
    });

    // Authenticated aggregate read. Always token-gated: unlike ingestion, a stats read
    // exposes data, so it requires OBJECTCORE_EVENTS_TOKEN to be set AND matched.
    app.get("/v1/events/stats", async (c) => {
      if (!opts.eventsToken) return c.json({ error: "stats requires a configured events token" }, 401);
      if (!bearerMatches(c.req.header("authorization"), opts.eventsToken)) {
        return c.json({ error: "unauthorized" }, 401);
      }
      return c.json(await sink.stats());
    });
  }

  // Self-service publish (the HTTP analogue of the release pipeline). Registered only
  // when injected — like channels/events, absent (404) otherwise. OIDC-verified,
  // policy-authorized, provenance-gated, then written through the CatalogStore port.
  if (opts.publish) {
    const { verifier, policy, store } = opts.publish;
    app.post("/v1/plugins", async (c) => {
      const auth = c.req.header("authorization");
      const token = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
      if (!token) return c.json({ error: "missing bearer token" }, 401);

      let claims;
      try {
        claims = await verifier.verify(token);
      } catch (e) {
        return c.json({ error: `invalid token: ${e instanceof Error ? e.message : String(e)}` }, 401);
      }
      const authz = authorizePublish(claims, policy);
      if (!authz.ok) return c.json({ error: authz.error }, 403);

      const read = await readJsonBounded(c, MAX_PUBLISH_BODY_BYTES);
      if (!read.ok) return c.json({ error: read.error }, read.status);
      const parsed = parsePublish(read.body);
      if (!parsed.ok) return c.json({ error: parsed.error }, 400);

      // Bind the published pin to the verified identity: an allowlisted repo must not
      // publish pins pointing at a repo it doesn't control (deriveCatalog serves the
      // repoUrl verbatim, so a spoofed one is an install-time integrity hole).
      const repo = typeof claims.repository === "string" ? claims.repository : "";
      if (!repoUrlMatchesClaim(parsed.value.repoUrl, repo)) {
        return c.json(
          { error: `repoUrl does not match the token's repository claim (${repo})` },
          403,
        );
      }

      // Re-enforce the provenance gate (AGENTS.md: an MCP-bundling plugin is a managed
      // credential). Single-sourced predicate from @objectcore/release, OR'd with the
      // publisher-declared root .mcp.json the server can't see.
      const needsProvenance = requiresProvenance(parsed.value.manifest) || parsed.value.bundlesMcp;
      if (needsProvenance && parsed.value.provenance === undefined) {
        return c.json({ error: "provenance required: an MCP-bundling plugin must publish an attestation" }, 422);
      }

      // Published versions are first-write-wins (the store enforces it). Surface a
      // drift attempt as 409 with the store's message — a publisher re-posting the
      // same version with different content needs "bump the version", not a 500.
      try {
        await store.upsertVersion(toStoredPlugin(parsed.value));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/immutable/i.test(msg)) return c.json({ error: msg }, 409);
        throw e;
      }
      await store.setChannel(parsed.value.channel, parsed.value.manifest.name, parsed.value.version);
      return c.json(
        { ok: true, name: parsed.value.manifest.name, version: parsed.value.version, ref: parsed.value.ref, channel: parsed.value.channel },
        201,
      );
    });
  }

  if (opts.channels) {
    app.get("/v1/:channel/marketplace.json", async (c) => {
      const channel = c.req.param("channel");
      const resolved = opts.channels!(channel);
      if (!resolved) return c.json({ error: `unknown channel: ${channel}` }, 404);
      const plugins = await resolved.source.listPlugins();
      const derive =
        typeof resolved.derive === "function" ? await resolved.derive() : resolved.derive;
      return catalogJson(c, deriveCatalog(plugins, derive));
    });
  }
  return app;
}
