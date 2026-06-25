// `bun run forge:scaffold <spec.json> [--force]` — the deterministic half of
// /forge. Takes a PluginSpec (produced by the grill + plan phases), emits the
// plugin (author defaulting to the marketplace owner), then re-derives, validates,
// writes marketplace.json, and runs the offline gate. The activation gate
// (`bun run eval`) needs a key and is the explicit next step.

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { scaffoldPlugin, type PluginSpec } from "@objectcore/forge";
import { loadConfig } from "./_workspace";
import { syncAndGate } from "./_finalize";

const specPath = process.argv[2];
if (!specPath) {
  console.error("usage: bun run forge:scaffold <spec.json> [--force]");
  process.exit(2);
}
const force = process.argv.includes("--force");

const root = join(import.meta.dir, "..");
const cfg = loadConfig(root);
const pluginsDir = join(root, "plugins");

const spec = JSON.parse(readFileSync(specPath, "utf8")) as PluginSpec;
// Identity lives in objectcore.config.json — default the author to the owner.
spec.author ??= cfg.owner;

const { dir, written } = await scaffoldPlugin(spec, pluginsDir, { force });
console.log(`✓ scaffolded ${spec.name} -> ${dir.slice(root.length + 1)}`);
for (const w of written) console.log(`    + ${w.slice(root.length + 1)}`);

const green = await syncAndGate(root);
console.log("\nNext: `bun run eval` to run the activation gate (needs an API key).");
if (!green) process.exit(1);
