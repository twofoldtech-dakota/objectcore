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
import { isSpecLoadError, specUnreadableResult } from "./spec";
import type { EvalResult } from "./types";

// The EXACT stub marker forge emits for an unfilled body (`<!-- forge:todo -->`).
// Match the full HTML-comment literal, not the bare "forge:todo" token: a filled
// body may legitimately *mention* the marker in prose (e.g. the self-reflection
// agent documents it as a failure mode), and that must not read as an unfilled stub.
const STUB_MARKER = "<!-- forge:todo -->";

// metaPluginSpec's auto-added placeholder positive case opens with this literal
// (`Help me with: ${skillDescription}`). It echoes the trigger surface back at the
// router, so it routes green under ANY judge while gating nothing — the eval-case
// analogue of an unfilled body, and gated the same way: legal at scaffold time,
// not shippable.
const PLACEHOLDER_PROMPT_PREFIX = "Help me with:";

const snippet = (s: string): string => (s.length > 50 ? s.slice(0, 47) + "..." : s);

/** One result per skill (does an activation case expect it?) and per agent (does a
 *  delegation case expect it?). Skills and agents are both trigger surfaces — a
 *  surface that never fires/never gets delegated to is worse than one that fails to
 *  parse — so both must be gated by a positive case before entering the catalog.
 *
 *  The reverse direction is checked too: every non-null `expect` must name a
 *  surface THIS plugin declares. A renamed/deleted skill leaving a stale case
 *  behind is a deterministic property — it must fail offline, not only when a
 *  judge happens to run (keyless local runs would otherwise pass it silently). */
export async function runCoverageEvals(
  plugins: WorkspacePlugin[],
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  for (const plugin of plugins) {
    const surfaces = await extractSurfaces(plugin);
    const skills = surfaces.filter((s) => s.kind === "skill");
    const agents = surfaces.filter((s) => s.kind === "agent");

    // Description floor: a surface whose description parsed to empty routes
    // against nothing — the judge sees a blank line, so activation/delegation is
    // ungatable. Catches both a missing description and one our frontmatter
    // reader could not recover. Only offenders are reported.
    for (const s of [...skills, ...agents]) {
      if (!s.description.trim()) {
        results.push({
          suite: "coverage",
          plugin: plugin.manifest.name,
          name: `has-description:${s.name}`,
          level: "error",
          passed: false,
          detail: `${s.kind} "${s.name}" has no usable description — an empty trigger surface cannot be routed or gated`,
        });
      }
    }

    const activation = await loadActivationSpec(plugin);
    if (isSpecLoadError(activation)) {
      results.push(specUnreadableResult("coverage", plugin, activation));
    } else {
      // expect-exists runs even with ZERO declared skills: a fully-deleted skill
      // set with leftover cases is the worst stale case. Scoped to the plugin's
      // OWN surfaces (forge's scaffold-time semantics), which also closes the
      // cross-plugin name-collision false-pass.
      const skillNames = new Set(skills.map((s) => s.name));
      (activation?.cases ?? []).forEach((c, i) => {
        if (c.expect !== null && !skillNames.has(c.expect)) {
          results.push({
            suite: "coverage",
            plugin: plugin.manifest.name,
            name: `expect-exists:case-${i}`,
            level: "error",
            passed: false,
            detail: `activation case ${i} expects unknown skill "${c.expect}" — not declared by this plugin`,
          });
        }
      });
      if (skills.length > 0) {
        const covered = new Set(
          (activation?.cases ?? []).map((c) => c.expect).filter((e): e is string => Boolean(e)),
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
    }

    const delegation = await loadDelegationSpec(plugin);
    if (isSpecLoadError(delegation)) {
      results.push(specUnreadableResult("coverage", plugin, delegation));
    } else {
      const agentNames = new Set(agents.map((a) => a.name));
      (delegation?.cases ?? []).forEach((c, i) => {
        if (c.expect !== null && !agentNames.has(c.expect)) {
          results.push({
            suite: "coverage",
            plugin: plugin.manifest.name,
            name: `delegation-expect-exists:case-${i}`,
            level: "error",
            passed: false,
            detail: `delegation case ${i} expects unknown agent "${c.expect}" — not declared by this plugin`,
          });
        }
      });
      if (agents.length > 0) {
        const covered = new Set(
          (delegation?.cases ?? []).map((c) => c.expect).filter((e): e is string => Boolean(e)),
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
  }
  return results;
}

/** Fail any case that is still forge's auto-added placeholder: a positive prompt
 *  opening with the metaPluginSpec literal, or a prompt/note carrying the stub
 *  marker. Same shape for activation and delegation (`kind` labels the result). */
function placeholderCaseResults(
  plugin: WorkspacePlugin,
  kind: "activation" | "delegation",
  cases: { prompt: string; expect: string | null; note?: string }[],
): EvalResult[] {
  const results: EvalResult[] = [];
  cases.forEach((c, i) => {
    const isPlaceholder =
      (c.expect !== null && c.prompt.startsWith(PLACEHOLDER_PROMPT_PREFIX)) ||
      c.prompt.includes(STUB_MARKER) ||
      (c.note?.includes(STUB_MARKER) ?? false);
    if (isPlaceholder) {
      results.push({
        suite: "coverage",
        plugin: plugin.manifest.name,
        name: `case-filled:${kind}:case-${i}`,
        level: "error",
        passed: false,
        detail: `${kind} case ${i} ("${snippet(c.prompt)}") is still the auto-added forge placeholder — it echoes the trigger surface and gates nothing; replace it with a real prompt`,
      });
    }
  });
  return results;
}

/** Ship-readiness checks (stricter than structural coverage): a skill-bearing
 *  plugin must ship a negative activation case, no skill body may still carry
 *  the forge:todo stub marker, and no eval case may still be forge's auto-added
 *  placeholder. Run by the full ship gate (scripts/eval.ts), NOT by the scaffold
 *  step (scripts/_finalize.ts) — a freshly scaffolded skeleton is a stub by
 *  design (plan 005). */
export async function runReadinessEvals(plugins: WorkspacePlugin[]): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  for (const plugin of plugins) {
    const surfaces = await extractSurfaces(plugin);
    const skills = surfaces.filter((s) => s.kind === "skill");
    const agents = surfaces.filter((s) => s.kind === "agent");

    if (skills.length > 0) {
      const spec = await loadActivationSpec(plugin);
      if (isSpecLoadError(spec)) {
        results.push(specUnreadableResult("coverage", plugin, spec));
      } else {
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
        results.push(...placeholderCaseResults(plugin, "activation", spec?.cases ?? []));
      }
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
      if (isSpecLoadError(spec)) {
        results.push(specUnreadableResult("coverage", plugin, spec));
      } else {
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
        results.push(...placeholderCaseResults(plugin, "delegation", spec?.cases ?? []));
      }
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
