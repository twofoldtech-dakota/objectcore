// `bun run eval` — the activation/output gate, now also the EDDOps evidence emitter.
//
// Output/coverage/readiness evals always run (deterministic, offline). Activation
// AND delegation evals run only when a judge is available (ANTHROPIC_API_KEY /
// ANTHROPIC_AUTH_TOKEN present); otherwise they are reported as SKIPPED rather than
// silently passing — an unevaluated trigger surface is exactly what this gate exists
// to catch.
//
// Every run — green or red — writes structured evidence to dist/eval-evidence.json
// (a build artifact, gitignored). That promotes the terminal gate to a continuous
// governing function: the reflection plugin's hook reads the evidence on a red gate
// and the self-reflection subagent diagnoses from it. The gate now FEEDS the loop.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AnthropicJudge,
  buildEvidence,
  buildReport,
  collectAgentSurfaces,
  collectSkillSurfaces,
  formatReport,
  hasApiKey,
  isGreen,
  runActivationEvals,
  runCoverageEvals,
  runDelegationEvals,
  runOutputEvals,
  runReadinessEvals,
  summarizeEvidence,
  DEFAULT_JUDGE_MODEL,
} from "@objectcore/eval";
import { loadWorkspace } from "./_workspace";

const root = join(import.meta.dir, "..");
const { plugins, catalog } = await loadWorkspace(root);

const results = await runOutputEvals(plugins, catalog);
results.push(...(await runCoverageEvals(plugins)));
results.push(...(await runReadinessEvals(plugins)));
const skipped: string[] = [];

if (hasApiKey()) {
  const judge = new AnthropicJudge();
  const model = process.env.OBJECTCORE_JUDGE_MODEL ?? DEFAULT_JUDGE_MODEL;
  console.log(`Running activation + delegation evals (judge: ${model})...`);
  const [skillSurfaces, agentSurfaces] = await Promise.all([
    collectSkillSurfaces(plugins),
    collectAgentSurfaces(plugins),
  ]);
  results.push(...(await runActivationEvals(plugins, skillSurfaces, judge)));
  results.push(...(await runDelegationEvals(plugins, agentSurfaces, judge)));
} else {
  skipped.push(
    "activation + delegation evals — no ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN. " +
      "Set one to run the trigger-surface gate (skill firing + agent delegation).",
  );
}

const report = buildReport(results, skipped);
console.log(formatReport(report));

// EDDOps: persist the run's evidence regardless of outcome (build artifact).
const evidence = buildEvidence(report, { now: new Date().toISOString() });
await mkdir(join(root, "dist"), { recursive: true });
await writeFile(
  join(root, "dist", "eval-evidence.json"),
  JSON.stringify(evidence, null, 2) + "\n",
  "utf8",
);

if (!isGreen(report)) {
  console.error(`\n${summarizeEvidence(evidence)}`);
  console.error(
    `\n✗ ${report.failed} eval(s) failed — gate is RED. Evidence: dist/eval-evidence.json. ` +
      `Delegate the \`self-reflection\` subagent to diagnose and capture any durable lesson.`,
  );
  process.exit(1);
}
console.log(`\n✓ eval gate is GREEN.`);
