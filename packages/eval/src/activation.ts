// Activation evals: the gate. For each case, the judge sees the WHOLE catalog's
// skill surfaces (a router doesn't see one skill in isolation) plus the prompt,
// and decides what fires. We score against the spec. A plugin "passes activation"
// only when every one of its cases passes — that is the rule AGENTS.md states:
// no plugin enters the catalog without passing its activation eval.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkspacePlugin } from "@objectcore/registry-core";
import type { ActivationSpec, EvalResult, Judge, TriggerSurface } from "./types";

/** Load `<plugin>/evals/activation.json` if present. */
export async function loadActivationSpec(
  plugin: WorkspacePlugin,
): Promise<ActivationSpec | null> {
  try {
    const raw = await readFile(join(plugin.dir, "evals", "activation.json"), "utf8");
    return JSON.parse(raw) as ActivationSpec;
  } catch {
    return null;
  }
}

const snippet = (s: string): string => (s.length > 50 ? s.slice(0, 47) + "..." : s);

/** Run one plugin's activation spec against the candidate surfaces. */
export async function runPluginActivation(
  plugin: WorkspacePlugin,
  spec: ActivationSpec,
  candidates: TriggerSurface[],
  judge: Judge,
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  for (let i = 0; i < spec.cases.length; i++) {
    const c = spec.cases[i]!;
    const decision = await judge.route(c.prompt, candidates);
    const passed = decision.skill === c.expect;
    const wantLabel = c.expect ?? "(no skill)";
    const gotLabel = decision.skill ?? "(no skill)";
    results.push({
      suite: "activation",
      plugin: plugin.manifest.name,
      name: `case-${i}: ${snippet(c.prompt)}`,
      level: "error",
      passed,
      detail: passed
        ? `fired ${gotLabel} as expected`
        : `expected ${wantLabel}, judge fired ${gotLabel} (${decision.reason})`,
    });
  }
  return results;
}

/** Run every plugin's activation spec. Plugins without a spec contribute nothing
 *  here (their gate is satisfied by validation + output evals only). */
export async function runActivationEvals(
  plugins: WorkspacePlugin[],
  candidates: TriggerSurface[],
  judge: Judge,
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  for (const plugin of plugins) {
    const spec = await loadActivationSpec(plugin);
    if (spec) {
      results.push(...(await runPluginActivation(plugin, spec, candidates, judge)));
    }
  }
  return results;
}
