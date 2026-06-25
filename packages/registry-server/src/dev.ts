import { join } from "node:path";
import { readFileSync } from "node:fs";
import { GitWorkspaceSource } from "@objectcore/registry-core";
import { createApp } from "./app";

const root = join(import.meta.dir, "..", "..", "..");
const cfg = JSON.parse(readFileSync(join(root, "objectcore.config.json"), "utf8"));

const app = createApp({
  source: new GitWorkspaceSource(join(root, "plugins")),
  derive: { name: cfg.name, owner: cfg.owner, pluginRoot: cfg.pluginRoot, schema: cfg.schema },
});

const port = Number(process.env.PORT ?? 8787);
console.log(`ObjectCore registry (dev) -> http://localhost:${port}/v1/marketplace.json`);
export default { port, fetch: app.fetch };
