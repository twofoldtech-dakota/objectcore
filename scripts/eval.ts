// `bun run eval` — the activation/output gate.
//
// Output evals always run (deterministic, offline). Activation evals run only
// when a judge is available (ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN present);
// otherwise they are reported as SKIPPED rather than silently passing — an
// unevaluated trigger surface is exactly what this gate exists to catch.

import { join } from "node:path";
import {
  AnthropicJudge,
  buildReport,
  collectSkillSurfaces,
  formatReport,
  hasApiKey,
  isGreen,
  runActivationEvals,
  runCoverageEvals,
  runOutputEvals,
  DEFAULT_JUDGE_MODEL,
} from "@objectcore/eval";
import { loadWorkspace } from "./_workspace";

const root = join(import.meta.dir, "..");
const { plugins, catalog } = await loadWorkspace(root);

const results = await runOutputEvals(plugins, catalog);
results.push(...(await runCoverageEvals(plugins)));
const skipped: string[] = [];

if (hasApiKey()) {
  const judge = new AnthropicJudge();
  const model = process.env.OBJECTCORE_JUDGE_MODEL ?? DEFAULT_JUDGE_MODEL;
  console.log(`Running activation evals (judge: ${model})...`);
  const surfaces = await collectSkillSurfaces(plugins);
  results.push(...(await runActivationEvals(plugins, surfaces, judge)));
} else {
  skipped.push(
    "activation evals — no ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN. " +
      "Set one to run the trigger-surface gate.",
  );
}

const report = buildReport(results, skipped);
console.log(formatReport(report));

if (!isGreen(report)) {
  console.error(`\n✗ ${report.failed} eval(s) failed — gate is RED.`);
  process.exit(1);
}
console.log(`\n✓ eval gate is GREEN.`);
