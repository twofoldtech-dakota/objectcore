// Coverage evals: deterministic, offline. They close the gap between "a skill
// exists" and "a skill is gated". The activation layer only runs the cases that
// are written — so a skill with ZERO cases targeting it would sail through the
// gate untested. This check fails any skill that has no positive activation case,
// enforcing the rule that every trigger surface is gated. (forge enforces this at
// generation time; this enforces it for hand-written plugins too.)

import type { WorkspacePlugin } from "@objectcore/registry-core";
import { extractSurfaces, readSkillBodies } from "./trigger-surface";
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

/** Ship-readiness checks (stricter than structural coverage): a skill-bearing
 *  plugin must ship a negative activation case, and no skill body may still carry
 *  the forge:todo stub marker. Run by the full ship gate (scripts/eval.ts), NOT by
 *  the scaffold step (scripts/_finalize.ts) — a freshly scaffolded skeleton is a
 *  stub by design (plan 005). */
export async function runReadinessEvals(plugins: WorkspacePlugin[]): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  for (const plugin of plugins) {
    const skills = (await extractSurfaces(plugin)).filter((s) => s.kind === "skill");
    if (skills.length === 0) continue;
    const spec = await loadActivationSpec(plugin);
    const hasNegative = (spec?.cases ?? []).some((c) => c.expect === null);
    results.push({
      suite: "coverage",
      plugin: plugin.manifest.name,
      name: "has-negative-case",
      level: "error",
      passed: hasNegative,
      detail: hasNegative
        ? "has at least one negative (expect:null) activation case"
        : "no negative activation case — the 'stays quiet on near-misses' half is ungated",
    });
    for (const { name, raw } of await readSkillBodies(plugin)) {
      const isStub = raw.includes("forge:todo");
      results.push({
        suite: "coverage",
        plugin: plugin.manifest.name,
        name: `body-filled:${name}`,
        level: "error",
        passed: !isStub,
        detail: isStub
          ? `skill "${name}" still has the forge:todo stub body — replace it with real instructions`
          : `skill "${name}" body is filled in`,
      });
    }
  }
  return results;
}
