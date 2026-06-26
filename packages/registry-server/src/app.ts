import { Hono } from "hono";
import {
  deriveCatalog,
  searchCatalog,
  parseEvent,
  type CatalogSource,
  type DeriveOpts,
  type EventSink,
} from "@objectcore/registry-core";

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
   *  the same inert-until-armed posture as deploy.yml / record-history.yml. */
  eventsToken?: string;
}

// The HTTP adapter. Dev-loop server now; the SAME app serves prod at Stage 3 (swap
// the injected CatalogSource Git -> DB). The route and output contract never change —
// that is what makes Stage 3 a relocation, not a rewrite.
export function createApp(opts: ServerOpts): Hono {
  const app = new Hono();

  // The ONLY endpoint Claude Code consumes. Stable forever.
  app.get("/v1/marketplace.json", async (c) => {
    const plugins = await opts.source.listPlugins();
    const derive = typeof opts.derive === "function" ? await opts.derive() : opts.derive;
    return c.json(deriveCatalog(plugins, derive));
  });

  app.get("/v1/search", async (c) => {
    const plugins = await opts.source.listPlugins();
    const derive = typeof opts.derive === "function" ? await opts.derive() : opts.derive;
    const catalog = deriveCatalog(plugins, derive);
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
      if (opts.eventsToken && c.req.header("authorization") !== `Bearer ${opts.eventsToken}`) {
        return c.json({ error: "unauthorized" }, 401);
      }
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "invalid JSON body" }, 400);
      }
      const parsed = parseEvent(body);
      if (!parsed.ok) return c.json({ error: parsed.error }, 400);
      await sink.record(parsed.event);
      return c.json({ ok: true }, 202);
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
      return c.json(deriveCatalog(plugins, derive));
    });
  }
  return app;
}
