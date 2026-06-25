import { Hono } from "hono";
import { deriveCatalog, type CatalogSource, type DeriveOpts } from "@objectcore/registry-core";

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
  return app;
}
