// Shared post-scaffold tail for the forge CLIs (forge-scaffold, forge-meta):
// re-derive the catalog, validate, write marketplace.json, and run the offline
// gate (output + coverage evals). Activation evals need a key and are run
// separately via `bun run eval`. Returns false if anything failed.

import { join } from "node:path";
import { GitFileSink, validateAll } from "@objectcore/registry-core";
import {
  buildReport,
  formatReport,
  isGreen,
  runCoverageEvals,
  runOutputEvals,
} from "@objectcore/eval";
import { loadWorkspace } from "./_workspace";

export async function syncAndGate(root: string): Promise<boolean> {
  const { plugins, catalog } = await loadWorkspace(root);

  const errors = (await validateAll(plugins, catalog)).filter((i) => i.level === "error");
  if (errors.length) {
    for (const i of errors) console.error(`[error] ${i.plugin ? i.plugin + ": " : ""}${i.message}`);
    console.error("\n✗ validation failed — marketplace.json NOT written.");
    return false;
  }

  await new GitFileSink(join(root, ".claude-plugin", "marketplace.json")).publish(catalog);
  console.log(`✓ catalog re-derived (${plugins.length} plugins)`);

  const results = [
    ...(await runOutputEvals(plugins, catalog)),
    ...(await runCoverageEvals(plugins)),
  ];
  const report = buildReport(results);
  console.log(formatReport(report));
  return isGreen(report);
}
