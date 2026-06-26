// Delegation evals: the agent analogue of the activation gate. A plugin-shipped
// subagent's `description` is its trigger surface exactly as a skill's is — it
// decides when the orchestrator delegates to it. Before F4 agents entered the
// catalog ungated on this; now each delegation case routes a prompt against the
// WHOLE catalog's AGENT surfaces (an orchestrator sees every available subagent,
// not one in isolation) and we score against the spec. Same `Judge` as activation:
// the routing decision is structurally identical (match description ↔ prompt, fire
// one or none); only the candidate pool — agents, not skills — differs.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkspacePlugin } from "@objectcore/registry-core";
import type { DelegationSpec, EvalResult, Judge, TriggerSurface } from "./types";

/** Load `<plugin>/evals/delegation.json` if present. */
export async function loadDelegationSpec(
  plugin: WorkspacePlugin,
): Promise<DelegationSpec | null> {
  try {
    const raw = await readFile(join(plugin.dir, "evals", "delegation.json"), "utf8");
    return JSON.parse(raw) as DelegationSpec;
  } catch {
    return null;
  }
}

const snippet = (s: string): string => (s.length > 50 ? s.slice(0, 47) + "..." : s);

/** Run one plugin's delegation spec against the candidate agent surfaces. */
export async function runPluginDelegation(
  plugin: WorkspacePlugin,
  spec: DelegationSpec,
  candidates: TriggerSurface[],
  judge: Judge,
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  for (let i = 0; i < spec.cases.length; i++) {
    const c = spec.cases[i]!;
    const decision = await judge.route(c.prompt, candidates);
    const passed = decision.skill === c.expect;
    const wantLabel = c.expect ?? "(no agent)";
    const gotLabel = decision.skill ?? "(no agent)";
    results.push({
      suite: "delegation",
      plugin: plugin.manifest.name,
      name: `case-${i}: ${snippet(c.prompt)}`,
      level: "error",
      passed,
      confidence: decision.confidence,
      detail: passed
        ? `delegated to ${gotLabel} as expected`
        : `expected ${wantLabel}, judge delegated to ${gotLabel} (${decision.reason})`,
    });
  }
  return results;
}

/** Run every plugin's delegation spec. Plugins without agents (or without a spec)
 *  contribute nothing here — their gate is the skill/output layers. */
export async function runDelegationEvals(
  plugins: WorkspacePlugin[],
  candidates: TriggerSurface[],
  judge: Judge,
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  for (const plugin of plugins) {
    const spec = await loadDelegationSpec(plugin);
    if (spec) {
      results.push(...(await runPluginDelegation(plugin, spec, candidates, judge)));
    }
  }
  return results;
}
