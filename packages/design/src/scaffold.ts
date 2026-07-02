// The generator — the design analogue of @objectcore/forge's `scaffoldPlugin`. Given a
// compact brief (brand hues, mood, base unit, type ratio), it emits a COMPLETE,
// ACCESSIBLE-BY-CONSTRUCTION DTCG token SSOT: a Radix-style 12-step role-mapped color
// scale per family (steps 1-2 app bg, 3-5 component bg, 6-8 borders, 9-10 solid, 11-12
// text), with the TEXT steps' lightness SOLVED so they meet WCAG contrast on EVERY
// canvas-class bg step the semantic set aliases (worst case: the step-3 raised surface
// — the "reverse" idea from the research, simplified to an L-search), plus a type
// scale from the ratio, a spacing ladder from the base unit, an M3 motion ladder, fonts,
// radii, the FULL semantic role contract (roles.ts — the roles the scale cannot
// guarantee by aliasing alone are solved per appearance), and a light/dark resolver.
// Like forge's scaffold it is a SKELETON to refine — but it self-gates against the
// contract at AA, so a fresh scaffold is already valid + accessible. Pure; never throws.

import type { ColorValue } from "./tokens";
import type { DesignSystemSource, ThemeSpec } from "./derive";
import { deriveDesignSystem } from "./derive";
import type { Resolver } from "./theme";
import type { TokenIssue } from "./schema";
import { validateTokens } from "./schema";
import { contrastRatio } from "./color";
import { checkContrast, checkTypeScale, checkSpacingGrid, M3_EASINGS } from "./gate";
import { contractPairs } from "./roles";
import type { SystemManifest } from "./sources";
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
  /** The `system.json` to write alongside the sets (what the system is gated to). */
  manifest?: SystemManifest;
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

/** Find a lightness at which the candidate meets EVERY constraint's contrast target
 *  against its paired color (darker for light mode, lighter for dark — the same
 *  monotone L-search as the text solve, generalized). WCAG contrast is SYMMETRIC, so
 *  one constraint form covers both directions: the candidate sitting ON a bg
 *  (accent.default vs the surfaces) and text sitting on the CANDIDATE
 *  (accent.on-accent on the solid) — every constraint tightens in the same direction,
 *  so the first passing L satisfies all of them. */
function solveRoleL(
  constraints: Array<{ against: ColorValue; target: number }>,
  hue: number,
  chroma: number,
  appearance: "light" | "dark",
): number {
  const ok = (L: number) => {
    const c = oklch(L, chroma, hue);
    return constraints.every((k) => (contrastRatio(c, k.against) ?? 0) >= k.target);
  };
  if (appearance === "light") {
    for (let L = 0.65; L >= 0.05; L -= 0.01) if (ok(L)) return r(L, 3);
    return 0.15;
  }
  for (let L = 0.55; L <= 0.99; L += 0.01) if (ok(L)) return r(L, 3);
  return 0.95;
}

/** Find a text lightness that meets `target` contrast on `bg` (darker for light mode,
 *  lighter for dark mode) — the simplified reverse-contrast construction; the
 *  single-constraint case of `solveRoleL`. */
const solveTextL = (bg: ColorValue, hue: number, chroma: number, appearance: "light" | "dark", target: number): number =>
  solveRoleL([{ against: bg, target }], hue, chroma, appearance);

/** A 12-step OKLCH scale for one appearance, with accessible text steps (11→AA, 12→AAA).
 *  Text is solved against `textBg` — the WORST-CASE bg the text will actually sit on.
 *  The semantic set aliases bg.base/bg.surface/bg.raised to steps 1-3, and step 3 is
 *  the binding constraint in BOTH appearances (darkest bg in light mode, lightest in
 *  dark), so solving there makes the base/surface pairs pass by construction. */
function generateScale(hue: number, chroma: number, appearance: "light" | "dark", textBg?: ColorValue): ColorValue[] {
  const ramp = appearance === "light" ? LIGHT_L : DARK_L;
  const steps: ColorValue[] = ramp.map((L, i) => oklch(L, chroma * CFRAC[i]!, hue));
  const bg = textBg ?? steps[2]!;
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

// The color-family names that opt a spec into the status./solid. contract roles —
// a family gets them only when the brief actually names it (presence-gated, like the
// contract pairs themselves). Contract order, so emission is deterministic.
const STATUS_FAMILIES = ["success", "warning", "danger"] as const;

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
  // The semantic text tokens (text.* and the status text steps) all sit on the NEUTRAL
  // surfaces (bg.base/surface/raised = neutral steps 1-3), so every family's text steps
  // are solved against the neutral worst-case bg (step 3) — not the family's own scale.
  const famChroma = (f: ScaffoldColor): number => f.chroma ?? (f.name === "neutral" ? 0.004 : 0.15);
  const neutral = families.find((f) => f.name === "neutral")!;
  const neutralCh = famChroma(neutral);
  const textBg = {
    light: generateScale(neutral.hue, neutralCh, "light")[2]!,
    dark: generateScale(neutral.hue, neutralCh, "dark")[2]!,
  };
  // Raw scales are kept (not just the alias tree) — the semantic solves below need
  // the concrete step values to constrain against.
  const scales = new Map<string, { light: ColorValue[]; dark: ColorValue[] }>();
  for (const f of families) {
    scales.set(f.name, {
      light: generateScale(f.hue, famChroma(f), "light", textBg.light),
      dark: generateScale(f.hue, famChroma(f), "dark", textBg.dark),
    });
  }
  const color: Record<string, unknown> = { $type: "color" };
  for (const [name, scale] of scales) {
    color[name] = { light: stepsToGroup(scale.light), dark: stepsToGroup(scale.dark) };
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

  // ── semantic (one set per appearance) — the FULL role contract (roles.ts) ──
  // bg/border/text alias the neutral scale's role bands (Radix mapping); text.disabled
  // (neutral 8) and border.subtle/strong are contract roles whose CONTRAST is exempt
  // by design — disabled text is the WCAG 1.4.3 exception, decorative separators are
  // not 1.4.11 boundaries (roles.ts EXEMPT_PAIRS). The roles the scale cannot
  // guarantee by aliasing alone are SOLVED per appearance:
  //   • border.input — ≥3:1 (SC 1.4.11) against neutral step 3, the most extreme
  //     canvas-class bg, so the gated bg.base/bg.surface rows pass a fortiori;
  //   • accent.default — solved against EVERY bg the contract gates it on as text
  //     (neutral step 3 for the canvas rows, accent step 3 = accent.subtle-bg) AND
  //     for accent.on-accent (= neutral step 1) sitting on it — the dual constraint;
  //   • accent.hover — one solve step further in the same direction (darker in light,
  //     lighter in dark), so its on-accent pair only gains contrast;
  //   • solid.<s> — the family's step 11 is already solved ≥4.5:1 against neutral
  //     step 3, and step 1 is MORE extreme than step 3 in both appearances, so
  //     solid.on-<s> passes a fortiori — re-solved only if that ever fails to hold.
  // accent.focus-ring aliases accent.default: the dual solve clears 4.5:1 on every
  // canvas bg, so the ring's non-text 3:1 rows hold by construction.
  const accent = families.find((f) => f.name === accentName)!;
  const statusNames = STATUS_FAMILIES.filter((s) => families.some((f) => f.name === s));

  const semantic = (app: "light" | "dark"): Record<string, unknown> => {
    const n = scales.get("neutral")![app];
    const a = scales.get(accentName)![app];
    const ref = (family: string, step: number) => ({ $value: `{color.${family}.${app}.${step}}` });

    const inputCh = neutralCh * CFRAC[6]!; // the step-7 border band it replaces
    const input = oklch(solveRoleL([{ against: n[2]!, target: 3 }], neutral.hue, inputCh, app), inputCh, neutral.hue);
    const accentCh = famChroma(accent) * CFRAC[8]!; // the step-9 solid band
    const defaultL = solveRoleL(
      [
        { against: n[2]!, target: 4.5 }, // accent.default on bg.base/surface/raised (worst case)
        { against: a[2]!, target: 4.5 }, // accent.default on accent.subtle-bg
        { against: n[0]!, target: 4.5 }, // accent.on-accent on accent.default
      ],
      accent.hue,
      accentCh,
      app,
    );
    const hoverL = r(defaultL + (app === "light" ? -0.01 : 0.01), 3);

    const status: Record<string, unknown> = { $type: "color" };
    const solid: Record<string, unknown> = { $type: "color" };
    for (const s of statusNames) {
      const fam = families.find((f) => f.name === s)!;
      const step11 = scales.get(s)![app][10]!;
      status[`${s}-bg`] = ref(s, 3);
      status[`${s}-text`] = ref(s, 12);
      solid[s] =
        (contrastRatio(n[0]!, step11) ?? 0) >= 4.5
          ? ref(s, 11)
          : (() => {
              const ch = famChroma(fam) * CFRAC[10]!;
              return { $value: oklch(solveRoleL([{ against: n[0]!, target: 4.5 }], fam.hue, ch, app), ch, fam.hue) };
            })();
      solid[`on-${s}`] = ref("neutral", 1);
    }

    return {
      bg: { $type: "color", base: ref("neutral", 1), surface: ref("neutral", 2), raised: ref("neutral", 3) },
      border: { $type: "color", subtle: ref("neutral", 6), strong: ref("neutral", 8), input: { $value: input } },
      text: {
        $type: "color",
        emphasis: ref("neutral", 12),
        primary: ref("neutral", 12),
        secondary: ref("neutral", 11),
        muted: ref("neutral", 11),
        disabled: ref("neutral", 8),
      },
      accent: {
        $type: "color",
        default: { $value: oklch(defaultL, accentCh, accent.hue) },
        hover: { $value: oklch(hoverL, accentCh, accent.hue) },
        "subtle-bg": ref(accentName, 3),
        "on-accent": ref("neutral", 1),
        "focus-ring": { $value: "{accent.default}" },
      },
      ...(statusNames.length > 0 ? { status, solid } : {}),
    };
  };

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
  const manifest: SystemManifest = { gate: { level: "AA" } };
  const issues: TokenIssue[] = [];
  for (const [name, set] of Object.entries(source.sets)) {
    for (const it of validateTokens(set)) issues.push({ level: it.level, token: it.token, message: `[${name}] ${it.message}` });
  }
  const out = deriveDesignSystem(source);
  issues.push(...out.issues);
  for (const theme of out.themes) {
    // The contract pair source (roles.ts) — the same rules design:check gates on,
    // legacy pairs included to mirror it exactly. The widened scaffold emits the full
    // contract and NO legacy role names; the one role name the two vocabularies share
    // (bg.surface) passes the pinned legacy `text.primary`@AAA row because step-12
    // text is solved to 7:1 against the more extreme step 3.
    issues.push(...checkContrast(contractPairs(theme, manifest.gate.level, { includeLegacy: true })));
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

  return { source, evalSpec, manifest, issues };
}
