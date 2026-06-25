import { Hono } from "hono";
import { deriveCatalog, GitWorkspaceSource, type DeriveOpts } from "@objectcore/registry-core";

export interface ServerOpts {
  pluginsDir: string;
  derive: DeriveOpts;
}

// The HTTP adapter. Dev-loop server now; the SAME app serves prod at Stage 3
// (swap GitWorkspaceSource -> RegistryDbSource; the contract and route do not change).
export function createApp(opts: ServerOpts): Hono {
  const app = new Hono();
  const source = new GitWorkspaceSource(opts.pluginsDir);

  // The ONLY endpoint Claude Code consumes. Stable forever.
  app.get("/v1/marketplace.json", async (c) => {
    const plugins = await source.listPlugins();
    return c.json(deriveCatalog(plugins, opts.derive));
  });

  app.get("/healthz", (c) => c.json({ ok: true }));
  return app;
}
