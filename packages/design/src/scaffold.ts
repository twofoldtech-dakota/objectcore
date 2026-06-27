// The generator — the design analogue of @objectcore/forge's `scaffoldPlugin`. Given a
// compact brief (brand hues, mood, base unit, type ratio), it emits a COMPLETE,
// ACCESSIBLE-BY-CONSTRUCTION DTCG token SSOT: a Radix-style 12-step role-mapped color
// scale per family (steps 1-2 app bg, 3-5 component bg, 6-8 borders, 9-10 solid, 11-12
// text), with the TEXT steps' lightness SOLVED so they meet WCAG contrast on the
// canvas (the "reverse" idea from the research, simplified to an L-search), plus a type
// scale from the ratio, a spacing ladder from the base unit, an M3 motion ladder, fonts,
// radii, semantic aliases, and a light/dark resolver. Like forge's scaffold it is a
// SKELETON to refine — but it self-gates against P2, so a fresh scaffold is already
// valid + accessible. Pure; never throws.

import type { ColorValue } from "./tokens";
import type { DesignSystemSource, ThemeSpec } from "./derive";
import { deriveDesignSystem } from "./derive";
import type { Resolver } from "./theme";
import type { TokenIssue } from "./schema";
import { validateTokens } from "./schema";
import { contrastRatio } from "./color";
import { checkContrast, checkTypeScale, checkSpacingGrid, M3_EASINGS } from "./gate";
import type { DesignBrief } from "./judge";
import type { DesignEvalSpec } from "./evaluate";

/** One brand color family, by OKLCH hue (+ optional chroma). */
export interface ScaffoldColor {
  name: string;
  /** OKLCH hue in degrees. */
  hue: number;
  /** OKLCH chroma at the vivid steps (default 0.15). */
  chroma?: number;
}

/** The compact input the grill+plan phases produce; `scaffoldDesignSystem` expands it. */
export interface ScaffoldSpec {
  brief: DesignBrief;
  /** Brand color families; the FIRST is the accent used in semantic aliases. ≥1. */
  colors: ScaffoldColor[];
  /** Neutral family hue (default = first color's hue). */
  neutralHue?: number;
  /** Spacing base unit in px (default 4). */
  baseUnit?: number;
  /** Base font size in px (default 16). */
  baseFontPx?: number;
  /** Modular type-scale ratio (default 1.25). */
  typeRatio?: number;
  fonts?: { sans?: string[]; serif?: string[]; mono?: string[] };
}

export interface ScaffoldResult {
  source: DesignSystemSource;
  evalSpec: DesignEvalSpec;
  /** Self-gate issues — empty for a well-formed brief (the scaffold is accessible by construction). */
  issues: TokenIssue[];
}

const r = (x: number, n = 4): number => Math.round(x * 10 ** n) / 10 ** n;
const oklch = (L: number, C: number, H: number): ColorValue => ({
  colorSpace: "oklch",
  components: [r(L, 4), r(Math.max(0, C), 4), r(H, 2)],
});

// Surface-step lightness ramps (steps 1-10); text steps 11-12 are solved separately.
const LIGHT_L = [0.995, 0.985, 0.965, 0.94, 0.915, 0.885, 0.85, 0.79, 0.62, 0.57];
const DARK_L = [0.17, 0.21, 0.255, 0.29, 0.33, 0.38, 0.45, 0.53, 0.62, 0.67];
// Chroma as a fraction of the family chroma, per step (muted at the ends, vivid mid).
const CFRAC = [0.03, 0.06, 0.12, 0.18, 0.24, 0.3, 0.4, 0.6, 1.0, 0.95, 0.85, 0.7];

/** Find a text lightness that meets `target` contrast on `bg` (darker for light mode,
 *  lighter for dark mode) — the simplified reverse-contrast construction. */
function solveTextL(bg: ColorValue, hue: number, chroma: number, appearance: "light" | "dark", target: number): number {
  const at = (L: number) => contrastRatio(oklch(L, chroma, hue), bg) ?? 0;
  if (appearance === "light") {
    for (let L = 0.65; L >= 0.05; L -= 0.01) if (at(L) >= target) return r(L, 3);
    return 0.15;
  }
  for (let L = 0.55; L <= 0.99; L += 0.01) if (at(L) >= target) return r(L, 3);
  return 0.95;
}

/** A 12-step OKLCH scale for one appearance, with accessible text steps (11→AA, 12→AAA). */
function generateScale(hue: number, chroma: number, appearance: "light" | "dark"): ColorValue[] {
  const ramp = appearance === "light" ? LIGHT_L : DARK_L;
  const steps: ColorValue[] = ramp.map((L, i) => oklch(L, chroma * CFRAC[i]!, hue));
  const bg = steps[0]!;
  const c11 = chroma * CFRAC[10]!;
  const c12 = chroma * CFRAC[11]!;
  steps.push(oklch(solveTextL(bg, hue, c11, appearance, 4.5), c11, hue)); // step 11 (low-contrast text)
  steps.push(oklch(solveTextL(bg, hue, c12, appearance, 7), c12, hue)); // step 12 (high-contrast text)
  return steps;
}

const stepsToGroup = (steps: ColorValue[]): Record<string, unknown> =>
  Object.fromEntries(steps.map((c, i) => [String(i + 1), { $value: c }]));

const TYPE_STEPS: Array<[string, number]> = [
  ["xs", -2], ["sm", -1], ["base", 0], ["lg", 1], ["xl", 2], ["2xl", 3], ["3xl", 4],
];
const SPACE_MULT = [0, 1, 2, 3, 4, 6, 8, 12, 16, 24];

/** Expand a brief into a full, self-gated DTCG token SSOT. Pure. */
export function scaffoldDesignSystem(spec: ScaffoldSpec): ScaffoldResult {
  if (spec.colors.length === 0) {
    return { source: { sets: {} }, evalSpec: { brief: spec.brief, cases: [] }, issues: [{ level: "error", message: "scaffold needs at least one brand color" }] };
  }
  const baseUnit = spec.baseUnit ?? 4;
  const baseFont = spec.baseFontPx ?? 16;
  const ratio = spec.typeRatio ?? 1.25;
  const accentName = spec.colors[0]!.name;

  const hasNeutral = spec.colors.some((c) => c.name === "neutral");
  const neutralHue = spec.neutralHue ?? spec.colors[0]!.hue;
  const families: ScaffoldColor[] = hasNeutral
    ? spec.colors
    : [{ name: "neutral", hue: neutralHue, chroma: 0.004 }, ...spec.colors];

  // ── primitives ──
  const color: Record<string, unknown> = { $type: "color" };
  for (const f of families) {
    const ch = f.name === "neutral" ? (f.chroma ?? 0.004) : (f.chroma ?? 0.15);
    color[f.name] = { light: stepsToGroup(generateScale(f.hue, ch, "light")), dark: stepsToGroup(generateScale(f.hue, ch, "dark")) };
  }

  // Font sizes in rem (relative to a 16px root) at 3-decimal precision — keeps the
  // modular ratio intact (integer-px rounding distorts it badly at small sizes).
  const size: Record<string, unknown> = { $type: "dimension" };
  for (const [name, off] of TYPE_STEPS) size[name] = { $value: { value: r((baseFont * ratio ** off) / 16, 3), unit: "rem" } };

  const space: Record<string, unknown> = { $type: "dimension" };
  for (const m of SPACE_MULT) space[String(m)] = { $value: { value: m * baseUnit, unit: "px" } };

  const primitives = {
    color,
    font: {
      family: {
        $type: "fontFamily",
        sans: { $value: spec.fonts?.sans ?? ["Inter", "system-ui", "sans-serif"] },
        serif: { $value: spec.fonts?.serif ?? ["Georgia", "serif"] },
        mono: { $value: spec.fonts?.mono ?? ["ui-monospace", "SFMono-Regular", "monospace"] },
      },
      size,
      weight: { $type: "fontWeight", regular: { $value: 400 }, medium: { $value: 500 }, semibold: { $value: 600 }, bold: { $value: 700 } },
    },
    space,
    radius: {
      $type: "dimension",
      sm: { $value: { value: baseUnit, unit: "px" } },
      md: { $value: { value: baseUnit * 2, unit: "px" } },
      lg: { $value: { value: baseUnit * 4, unit: "px" } },
      full: { $value: { value: 9999, unit: "px" } },
    },
    motion: {
      duration: {
        $type: "duration",
        fast: { $value: { value: 150, unit: "ms" } },
        normal: { $value: { value: 250, unit: "ms" } },
        slow: { $value: { value: 400, unit: "ms" } },
        slower: { $value: { value: 600, unit: "ms" } },
      },
      easing: {
        $type: "cubicBezier",
        standard: { $value: M3_EASINGS.standard },
        decelerate: { $value: M3_EASINGS["emphasized-decelerate"] },
        accelerate: { $value: M3_EASINGS["emphasized-accelerate"] },
      },
    },
  };

  // ── semantic (one set per appearance) ──
  const semantic = (app: "light" | "dark"): Record<string, unknown> => ({
    bg: { $type: "color", canvas: { $value: `{color.neutral.${app}.1}` }, subtle: { $value: `{color.neutral.${app}.2}` }, surface: { $value: `{color.neutral.${app}.3}` } },
    border: { $type: "color", subtle: { $value: `{color.neutral.${app}.6}` }, default: { $value: `{color.neutral.${app}.7}` }, strong: { $value: `{color.neutral.${app}.8}` } },
    text: { $type: "color", subtle: { $value: `{color.neutral.${app}.11}` }, primary: { $value: `{color.neutral.${app}.12}` } },
    accent: { $type: "color", solid: { $value: `{color.${accentName}.${app}.9}` }, "solid-hover": { $value: `{color.${accentName}.${app}.10}` }, text: { $value: `{color.${accentName}.${app}.11}` } },
  });

  const resolver: Resolver = {
    resolutionOrder: ["primitives", "theme"],
    modifiers: [{ name: "theme", contexts: { light: ["semantic-light"], dark: ["semantic-dark"] } }],
  };
  const themes: ThemeSpec[] = [
    { name: "light", context: { theme: "light" } },
    { name: "dark", context: { theme: "dark" } },
  ];
  const source: DesignSystemSource = {
    sets: { primitives, "semantic-light": semantic("light"), "semantic-dark": semantic("dark") },
    resolver,
    themes,
  };

  // ── self-gate (P2): structure, resolution, contrast, scales ──
  const issues: TokenIssue[] = [];
  for (const [name, set] of Object.entries(source.sets)) {
    for (const it of validateTokens(set)) issues.push({ level: it.level, token: it.token, message: `[${name}] ${it.message}` });
  }
  const out = deriveDesignSystem(source);
  issues.push(...out.issues);
  for (const theme of out.themes) {
    const get = (p: string) => theme.tokens.find((t) => t.path === p)?.value;
    issues.push(
      ...checkContrast([
        { label: `${theme.name}: text.primary on bg.canvas`, fg: get("text.primary"), bg: get("bg.canvas"), level: "AAA" },
        { label: `${theme.name}: text.subtle on bg.canvas`, fg: get("text.subtle"), bg: get("bg.canvas") },
      ]),
    );
  }
  issues.push(...checkTypeScale(TYPE_STEPS.map(([n]) => (size[n] as { $value: { value: number } }).$value.value), { ratio }));
  issues.push(...checkSpacingGrid(SPACE_MULT.map((m) => m * baseUnit), { base: baseUnit }));

  // ── a starter design.json (the on-brand bracket) ──
  const adj = spec.brief.adjectives.join(", ");
  const evalSpec: DesignEvalSpec = {
    brief: spec.brief,
    cases: [
      { question: `Does this system read as ${adj}?`, expect: "pass", note: "brand adjectives — refine and verify with a real judge" },
      { question: `Does this system read as garish, cluttered, or generic/off-brand?`, expect: "fail", note: "negative bracket" },
    ],
  };

  return { source, evalSpec, issues };
}
