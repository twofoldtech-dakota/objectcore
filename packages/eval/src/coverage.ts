// Coverage evals: deterministic, offline. They close the gap between "a skill
// exists" and "a skill is gated". The activation layer only runs the cases that
// are written — so a skill with ZERO cases targeting it would sail through the
// gate untested. This check fails any skill that has no positive activation case,
// enforcing the rule that every trigger surface is gated. (forge enforces this at
// generation time; this enforces it for hand-written plugins too.)

import type { WorkspacePlugin } from "@objectcore/registry-core";
import { extractSurfaces } from "./trigger-surface";
import { loadActivationSpec } from "./activation";
import type { EvalResult } from "./types";

/** One result per skill: does at least one activation case expect it to fire? */
export async function runCoverageEvals(
  plugins: WorkspacePlugin[],
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  for (const plugin of plugins) {
    const skills = (await extractSurfaces(plugin)).filter((s) => s.kind === "skill");
    if (skills.length === 0) continue;
    const spec = await loadActivationSpec(plugin);
    const covered = new Set(
      (spec?.cases ?? []).map((c) => c.expect).filter((e): e is string => Boolean(e)),
    );
    for (const s of skills) {
      const passed = covered.has(s.name);
      results.push({
        suite: "coverage",
        plugin: plugin.manifest.name,
        name: `covers:${s.name}`,
        level: "error",
        passed,
        detail: passed
          ? `skill "${s.name}" has a positive activation case`
          : `skill "${s.name}" has no positive activation case — it would enter the catalog ungated`,
      });
    }
  }
  return results;
}
