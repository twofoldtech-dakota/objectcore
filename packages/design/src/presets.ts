// Seeded theme presets (plan 014) — the curated quick-start path. A preset is a
// COMPLETE, checked-in design system (engine-native DTCG sets converted one-shot
// from the POC; provenance + every deviation recorded in `preset.json`'s `source`)
// that `instantiatePreset` expands into the same `ScaffoldResult` the scaffold
// produces — same seam (`deriveDesignSystem`), same gate, same sinks. The compact-
// spec→full-result shape follows forge's `metaPluginSpec`. Presets are STATIC JSON
// imports (resolveJsonModule): no runtime I/O, the core stays pure and zero-dep.
// Pure; never throws — bad input comes back as issues, like the scaffold.

import type { TokenIssue } from "./schema";
import { validateTokens } from "./schema";
import type { DesignSystemSource, ThemeSpec } from "./derive";
import { deriveDesignSystem } from "./derive";
import type { Resolver } from "./theme";
import type { GateLevel } from "./roles";
import { checkContractCoverage } from "./roles";
import { checkContractContrast } from "./proof";
import type { SystemManifest } from "./sources";
import type { DesignBrief } from "./judge";
import type { DesignEvalCase } from "./evaluate";
import type { ScaffoldResult } from "./scaffold";

import inkwellMeta from "../presets/inkwell/preset.json";
import inkwellCopy from "../presets/inkwell/spec-copy.json";
import inkwellPrimitives from "../presets/inkwell/primitives.tokens.json";
import inkwellShared from "../presets/inkwell/semantic-shared.tokens.json";
import inkwellPaper from "../presets/inkwell/semantic-paper.tokens.json";
import inkwellInk from "../presets/inkwell/semantic-ink.tokens.json";
import inkwellStudy from "../presets/inkwell/semantic-study.tokens.json";
import inkwellKiln from "../presets/inkwell/semantic-kiln.tokens.json";
import inkwellArboretum from "../presets/inkwell/semantic-arboretum.tokens.json";
import inkwellNocturne from "../presets/inkwell/semantic-nocturne.tokens.json";

import cathodeMeta from "../presets/cathode/preset.json";
import cathodeCopy from "../presets/cathode/spec-copy.json";
import cathodePrimitives from "../presets/cathode/primitives.tokens.json";
import cathodeShared from "../presets/cathode/semantic-shared.tokens.json";
import cathodeGlass from "../presets/cathode/semantic-glass.tokens.json";
import cathodeDaylight from "../presets/cathode/semantic-daylight.tokens.json";
import cathodeTerminal from "../presets/cathode/semantic-terminal.tokens.json";
import cathodeBlueprint from "../presets/cathode/semantic-blueprint.tokens.json";
import cathodeLedger from "../presets/cathode/semantic-ledger.tokens.json";
import cathodeManila from "../presets/cathode/semantic-manila.tokens.json";
import cathodeLitmus from "../presets/cathode/semantic-litmus.tokens.json";
import cathodeSonar from "../presets/cathode/semantic-sonar.tokens.json";
import cathodeRedline from "../presets/cathode/semantic-redline.tokens.json";

/** One theme a preset ships. `appearance` is authored from the MEASURED
 *  `relativeLuminance(bg.base)` (tested, not promised); `default` marks the
 *  appearance's default — the preset's first default is the overall default,
 *  ordered first in the instantiated `themes[]` (CssVarSink's `:root`). */
export interface PresetThemeInfo {
  name: string;
  appearance: "light" | "dark";
  default?: boolean;
  description?: string;
}

/** The `--list` metadata for one preset (the `preset.json` header). */
export interface PresetInfo {
  name: string;
  version: string;
  description: string;
  /** Every contract text pair in every theme gates at this level (both ship AAA). */
  level: GateLevel;
  themes: PresetThemeInfo[];
  brief: DesignBrief;
}

/** The full checked-in preset: metadata + the engine-native token sets. */
export interface Preset extends PresetInfo {
  /** The judged on-brand bracket (`evals/design.json` cases) the seed ships with. */
  cases: DesignEvalCase[];
  /** Conversion provenance + every deviation from the POC source (the AAA patch). */
  source: string;
  /** Token sets keyed by set name: `primitives`, `shared`, `semantic-<theme>`. */
  sets: Record<string, Record<string, unknown>>;
  /** Editorial voice for the generated spec page (SpecCopy-shaped; spec.ts owns the type). */
  specCopy?: Record<string, unknown>;
}

/** The `preset.json` shape (the imported literal is asserted to it; the preset
 *  tests are the shape gate — checked-in package data, not user input). */
type PresetFile = Omit<Preset, "sets" | "specCopy">;

const PRESETS: readonly Preset[] = [
  {
    ...(inkwellMeta as PresetFile),
    sets: {
      primitives: inkwellPrimitives,
      shared: inkwellShared,
      "semantic-paper": inkwellPaper,
      "semantic-ink": inkwellInk,
      "semantic-study": inkwellStudy,
      "semantic-kiln": inkwellKiln,
      "semantic-arboretum": inkwellArboretum,
      "semantic-nocturne": inkwellNocturne,
    },
    specCopy: inkwellCopy,
  },
  {
    ...(cathodeMeta as PresetFile),
    sets: {
      primitives: cathodePrimitives,
      shared: cathodeShared,
      "semantic-glass": cathodeGlass,
      "semantic-daylight": cathodeDaylight,
      "semantic-terminal": cathodeTerminal,
      "semantic-blueprint": cathodeBlueprint,
      "semantic-ledger": cathodeLedger,
      "semantic-manila": cathodeManila,
      "semantic-litmus": cathodeLitmus,
      "semantic-sonar": cathodeSonar,
      "semantic-redline": cathodeRedline,
    },
    specCopy: cathodeCopy,
  },
];

/** The preset inventory (metadata only) — what `design:seed --list` renders. */
export function listPresets(): PresetInfo[] {
  return PRESETS.map(({ name, version, description, level, themes, brief }) => ({
    name, version, description, level, themes, brief,
  }));
}

/** The full preset by name, or undefined. */
export function getPreset(name: string): Preset | undefined {
  return PRESETS.find((p) => p.name === name);
}

export interface InstantiateOptions {
  /** Rename the seeded system (defaults to the preset name). */
  name?: string;
  /** Theme subset by name; absent ⇒ every theme. Output order is preset order
   *  with default themes first, regardless of the order given here. */
  themes?: string[];
}

const names = (themes: readonly PresetThemeInfo[]): string => themes.map((t) => t.name).join(", ");

/** Expand a preset into a gate-passing `ScaffoldResult` — the quick-start half of
 *  /design, converging on the same seam and gate as `scaffoldDesignSystem`. Sets
 *  are primitives + shared + one semantic set per selected theme (NO ramp pruning —
 *  the full palette travels); the manifest declares the preset's level with
 *  `coverage: "full"` plus seed provenance. Pure. */
export function instantiatePreset(preset: string, opts: InstantiateOptions = {}): ScaffoldResult {
  const p = getPreset(preset);
  const name = opts.name ?? preset;
  const refuse = (issues: TokenIssue[]): ScaffoldResult => ({
    source: { sets: {} },
    evalSpec: { brief: { name, adjectives: [] }, cases: [] },
    issues,
  });
  if (!p) {
    return refuse([{
      level: "error",
      message: `unknown preset \`${preset}\` — valid presets: ${PRESETS.map((x) => x.name).join(", ")}`,
    }]);
  }

  // ── theme selection (issues-not-throws; preset order, defaults first) ──
  let selected = p.themes;
  if (opts.themes) {
    const errors: TokenIssue[] = [];
    if (opts.themes.length === 0) {
      errors.push({ level: "error", message: `empty theme subset — pick at least one of: ${names(p.themes)}` });
    }
    const known = new Set(p.themes.map((t) => t.name));
    for (const t of opts.themes) {
      if (!known.has(t)) {
        errors.push({ level: "error", message: `preset \`${p.name}\` has no theme \`${t}\` — valid themes: ${names(p.themes)}` });
      }
    }
    if (errors.length) return refuse(errors);
    const want = new Set(opts.themes);
    selected = p.themes.filter((t) => want.has(t.name));
  }
  const ordered = [...selected].sort((a, b) => Number(b.default ?? false) - Number(a.default ?? false));

  const issues: TokenIssue[] = [];
  for (const app of ["light", "dark"] as const) {
    if (!ordered.some((t) => t.appearance === app)) {
      issues.push({ level: "warning", message: `the theme selection has no ${app} theme — the seeded system is ${app === "light" ? "dark" : "light"}-only` });
    }
  }

  // ── the source: primitives + shared + one semantic set per selected theme ──
  const sets: Record<string, Record<string, unknown>> = {
    primitives: p.sets.primitives!,
    shared: p.sets.shared!,
  };
  for (const t of ordered) sets[`semantic-${t.name}`] = p.sets[`semantic-${t.name}`]!;
  const resolver: Resolver = {
    resolutionOrder: ["primitives", "shared", "theme"],
    modifiers: [{ name: "theme", contexts: Object.fromEntries(ordered.map((t) => [t.name, [`semantic-${t.name}`]])) }],
  };
  const themes: ThemeSpec[] = ordered.map((t) => ({ name: t.name, context: { theme: t.name } }));
  const source: DesignSystemSource = { sets, resolver, themes };

  const manifest: SystemManifest = {
    gate: { level: p.level, coverage: "full" },
    seed: { preset: p.name, version: p.version, themes: ordered.map((t) => t.name) },
  };

  // ── self-gate: the exact checks design:check will re-run over the output ──
  for (const [setName, set] of Object.entries(sets)) {
    for (const it of validateTokens(set)) issues.push({ level: it.level, token: it.token, message: `[${setName}] ${it.message}` });
  }
  const out = deriveDesignSystem(source);
  issues.push(...out.issues);
  for (const theme of out.themes) issues.push(...checkContractCoverage(theme));
  issues.push(...checkContractContrast(out, { level: p.level }));

  return {
    source,
    evalSpec: { brief: { ...p.brief, name }, cases: p.cases },
    manifest,
    issues,
  };
}
