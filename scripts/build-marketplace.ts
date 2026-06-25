import { join } from "node:path";
import { GitFileSink, validateAll } from "@objectcore/registry-core";
import { loadWorkspace } from "./_workspace";

const root = join(import.meta.dir, "..");
const { plugins, catalog } = await loadWorkspace(root);

const issues = await validateAll(plugins, catalog);
for (const i of issues) {
  console.error(`[${i.level}] ${i.plugin ? i.plugin + ": " : ""}${i.message}`);
}
const errors = issues.filter((i) => i.level === "error");
if (errors.length) {
  console.error(`\n✗ ${errors.length} error(s) — marketplace.json NOT written.`);
  process.exit(1);
}

await new GitFileSink(join(root, ".claude-plugin", "marketplace.json")).publish(catalog);
console.log(`✓ ${plugins.length} plugin(s) -> .claude-plugin/marketplace.json`);
