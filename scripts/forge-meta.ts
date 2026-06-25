// `bun run forge:meta <meta-spec.json> [--force]` — generate a new META-plugin
// (a plugin that produces or governs other plugins). Expands a compact meta-spec
// via metaPluginSpec (archetype-aware, coverage-guaranteed) into a full PluginSpec,
// scaffolds it with the author defaulting to the marketplace owner, then runs the
// offline gate. This is the factory making more of its own kind.

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { metaPluginSpec, scaffoldPlugin, type MetaSpecInput } from "@objectcore/forge";
import { loadConfig } from "./_workspace";
import { syncAndGate } from "./_finalize";

const specPath = process.argv[2];
if (!specPath) {
  console.error("usage: bun run forge:meta <meta-spec.json> [--force]");
  process.exit(2);
}
const force = process.argv.includes("--force");

const root = join(import.meta.dir, "..");
const cfg = loadConfig(root);
const pluginsDir = join(root, "plugins");

const input = JSON.parse(readFileSync(specPath, "utf8")) as MetaSpecInput;
const spec = metaPluginSpec(input);
spec.author ??= cfg.owner; // identity from the single source

const { dir, written } = await scaffoldPlugin(spec, pluginsDir, { force });
console.log(`✓ scaffolded meta-plugin ${spec.name} (${input.archetype}) -> ${dir.slice(root.length + 1)}`);
for (const w of written) console.log(`    + ${w.slice(root.length + 1)}`);

const green = await syncAndGate(root);
console.log("\nNext: refine the activation prose, then `bun run eval` to run the activation gate.");
if (!green) process.exit(1);
