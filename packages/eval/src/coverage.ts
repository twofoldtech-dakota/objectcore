// Coverage evals: deterministic, offline. They close the gap between "a skill
// exists" and "a skill is gated". The activation layer only runs the cases that
// are written — so a skill with ZERO cases targeting it would sail through the
// gate untested. This check fails any skill that has no positive activation case,
// enforcing the rule that every trigger surface is gated. (forge enforces this at
// generation time; this enforces it for hand-written plugins too.)

import type { WorkspacePlugin } from "@objectcore/registry-core";
import { extractSurfaces, readAgentBodies, readSkillBodies } from "./trigger-surface";
import { loadActivationSpec } from "./activation";
import { loadDelegationSpec } from "./delegation";
import type { EvalResult } from "./types";

// The EXACT stub marker forge emits for an unfilled body (`<!-- forge:todo -->`).
// Match the full HTML-comment literal, not the bare "forge:todo" token: a filled
// body may legitimately *mention* the marker in prose (e.g. the self-reflection
// agent documents it as a failure mode), and that must not read as an unfilled stub.
const STUB_MARKER = "<!-- forge:todo -->";

/** One result per skill (does an activation case expect it?) and per agent (does a
 *  delegation case expect it?). Skills and agents are both trigger surfaces — a
 *  surface that never fires/never gets delegated to is worse than one that fails to
 *  parse — so both must be gated by a positive case before entering the catalog. */
export async function runCoverageEvals(
  plugins: WorkspacePlugin[],
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  for (const plugin of plugins) {
    const surfaces = await extractSurfaces(plugin);

    const skills = surfaces.filter((s) => s.kind === "skill");
    if (skills.length > 0) {
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

    const agents = surfaces.filter((s) => s.kind === "agent");
    if (agents.length > 0) {
      const spec = await loadDelegationSpec(plugin);
      const covered = new Set(
        (spec?.cases ?? []).map((c) => c.expect).filter((e): e is string => Boolean(e)),
      );
      for (const a of agents) {
        const passed = covered.has(a.name);
        results.push({
          suite: "coverage",
          plugin: plugin.manifest.name,
          name: `delegates:${a.name}`,
          level: "error",
          passed,
          detail: passed
            ? `agent "${a.name}" has a positive delegation case`
            : `agent "${a.name}" has no positive delegation case — it would enter the catalog ungated on delegation`,
        });
      }
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
    const surfaces = await extractSurfaces(plugin);
    const skills = surfaces.filter((s) => s.kind === "skill");
    const agents = surfaces.filter((s) => s.kind === "agent");

    if (skills.length > 0) {
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
        const isStub = raw.includes(STUB_MARKER);
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

    if (agents.length > 0) {
      const spec = await loadDelegationSpec(plugin);
      const hasNegative = (spec?.cases ?? []).some((c) => c.expect === null);
      results.push({
        suite: "coverage",
        plugin: plugin.manifest.name,
        name: "has-negative-delegation",
        level: "error",
        passed: hasNegative,
        detail: hasNegative
          ? "has at least one negative (expect:null) delegation case"
          : "no negative delegation case — 'stays quiet, doesn't over-delegate' is ungated",
      });
      for (const { name, raw } of await readAgentBodies(plugin)) {
        const isStub = raw.includes(STUB_MARKER);
        results.push({
          suite: "coverage",
          plugin: plugin.manifest.name,
          name: `agent-body-filled:${name}`,
          level: "error",
          passed: !isStub,
          detail: isStub
            ? `agent "${name}" still has the forge:todo stub body — replace it with the real system prompt`
            : `agent "${name}" body is filled in`,
        });
      }
    }
  }
  return results;
}
