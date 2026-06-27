// The deterministic gate floor — the design-token analogue of registry-core's
// `validate.ts`. Everything here is a pure numeric assertion (the research's central
// finding: color/type/spacing/fluid/motion are all closed-form checkable, no LLM
// needed). The judged "is it on-brand" half lives in P3. WCAG 2.2 is the HARD contrast
// floor; APCA (apca.ts) is advisory. Caveats encoded per the research: scale/clamp
// checks use NUMERIC TOLERANCE (cross-tool rounding differs, never byte-compare), and
// Material-3 motion is a reference set (advisory), with `emphasized` flagged as a
// spline that a single cubic-bezier can't match. Pure; never throws.

import type { TokenIssue } from "./schema";
import { contrastRatio } from "./color";

// ── Contrast (WCAG 2.2) — the hard gate ───────────────────────────────────────

export interface ContrastPair {
  /** Human label for the pair, e.g. "text on background". */
  label: string;
  fg: unknown;
  bg: unknown;
  level?: "AA" | "AAA";
  /** ≥18pt regular / ≥14pt bold. */
  large?: boolean;
  /** UI component / graphical object (1.4.11) — always a 3:1 floor. */
  nonText?: boolean;
}

/** Required ratio for a pair under WCAG 2.2 (SC 1.4.3 / 1.4.6 / 1.4.11). */
export function requiredRatio(pair: ContrastPair): number {
  if (pair.nonText) return 3;
  const aaa = pair.level === "AAA";
  return pair.large ? (aaa ? 4.5 : 3) : aaa ? 7 : 4.5;
}

/** Assert each pair meets its WCAG 2.2 threshold. Failing pairs are errors;
 *  uncomputable colors (wide-gamut/unsupported) are warnings, never silent passes. */
export function checkContrast(pairs: ContrastPair[]): TokenIssue[] {
  const issues: TokenIssue[] = [];
  for (const pair of pairs) {
    const ratio = contrastRatio(pair.fg, pair.bg);
    const need = requiredRatio(pair);
    if (ratio == null) {
      issues.push({ level: "warning", token: pair.label, message: `could not compute contrast (unsupported color space)` });
      continue;
    }
    if (ratio < need) {
      issues.push({
        level: "error",
        token: pair.label,
        message: `contrast ${ratio.toFixed(2)}:1 is below the ${need}:1 floor (${pair.level ?? "AA"}${pair.large ? ", large" : pair.nonText ? ", non-text" : ""})`,
      });
    }
  }
  return issues;
}

// ── Type scale (modular) ──────────────────────────────────────────────────────

/** Assert an ascending list of font sizes follows a constant ratio (size = base ×
 *  ratio^step ⇒ consecutive ratios ≈ `ratio`). Relative tolerance absorbs rounding. */
export function checkTypeScale(
  sizes: number[],
  opts: { ratio: number; tolerance?: number; label?: string },
): TokenIssue[] {
  const tol = opts.tolerance ?? 0.03;
  const label = opts.label ?? "type-scale";
  const issues: TokenIssue[] = [];
  for (let i = 0; i + 1 < sizes.length; i++) {
    const a = sizes[i]!, b = sizes[i + 1]!;
    if (a <= 0) { issues.push({ level: "error", token: label, message: `size at index ${i} must be positive` }); continue; }
    const got = b / a;
    if (Math.abs(got - opts.ratio) / opts.ratio > tol) {
      issues.push({ level: "error", token: label, message: `step ${i}→${i + 1} ratio ${got.toFixed(3)} deviates from ${opts.ratio} (tol ${tol})` });
    }
  }
  return issues;
}

// ── Spacing grid ──────────────────────────────────────────────────────────────

/** Assert every spacing value is an (integer) multiple of a base unit (4/8pt grid). */
export function checkSpacingGrid(
  values: number[],
  opts: { base: number; tolerance?: number; label?: string },
): TokenIssue[] {
  const tol = opts.tolerance ?? 0.001;
  const label = opts.label ?? "spacing";
  const issues: TokenIssue[] = [];
  if (opts.base <= 0) return [{ level: "error", token: label, message: "base unit must be positive" }];
  for (const v of values) {
    const m = v / opts.base;
    if (Math.abs(m - Math.round(m)) > tol) {
      issues.push({ level: "error", token: label, message: `${v} is not a multiple of the ${opts.base} base unit` });
    }
  }
  return issues;
}

// ── Fluid type (clamp) ────────────────────────────────────────────────────────

export interface FluidInputs {
  minPx: number;
  maxPx: number;
  minVw: number;
  maxVw: number;
  /** Root font size for rem conversion (default 16). */
  rootPx?: number;
}

export interface ClampCoeffs {
  minRem: number;
  /** The `vw` coefficient of the middle term. */
  slopeVw: number;
  interceptRem: number;
}

/** Closed-form `clamp(min, slope·vw + intercept, max)` from the four endpoints. */
export function computeFluidClamp(i: FluidInputs): ClampCoeffs {
  const root = i.rootPx ?? 16;
  const slopePxPerVw = (i.maxPx - i.minPx) / (i.maxVw - i.minVw);
  return {
    minRem: i.minPx / root,
    slopeVw: slopePxPerVw * 100,
    interceptRem: (i.minPx - slopePxPerVw * i.minVw) / root,
  };
}

/** Assert an authored clamp matches the closed-form recomputation (within tolerance). */
export function checkFluidClamp(
  authored: ClampCoeffs,
  inputs: FluidInputs,
  opts: { tolerance?: number; label?: string } = {},
): TokenIssue[] {
  const tol = opts.tolerance ?? 0.01;
  const label = opts.label ?? "fluid-type";
  const want = computeFluidClamp(inputs);
  const issues: TokenIssue[] = [];
  const cmp = (name: keyof ClampCoeffs) => {
    if (Math.abs(authored[name] - want[name]) > tol) {
      issues.push({ level: "error", token: label, message: `${name} ${authored[name]} deviates from computed ${want[name].toFixed(4)} (tol ${tol})` });
    }
  };
  cmp("minRem");
  cmp("slopeVw");
  cmp("interceptRem");
  return issues;
}

// ── Motion (Material 3 reference — advisory) ──────────────────────────────────

/** The Material-3 duration ladder (ms): short/medium/long ×4 + extra-long ×4. */
export const M3_DURATIONS: readonly number[] = [
  50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 700, 800, 900, 1000,
];

/** Material-3 easing tokens as exact cubic-beziers. NOTE: `emphasized` itself is a
 *  two-segment spline (a PathInterpolator), NOT expressible as one cubic-bezier — it
 *  is intentionally absent here; validate it as a spline, not a 4-tuple. */
export const M3_EASINGS: Record<string, [number, number, number, number]> = {
  standard: [0.2, 0, 0, 1.0],
  "standard-decelerate": [0, 0, 0, 1],
  "standard-accelerate": [0.3, 0, 1, 1],
  "emphasized-decelerate": [0.05, 0.7, 0.1, 1.0],
  "emphasized-accelerate": [0.3, 0, 0.8, 0.15],
};

export const EMPHASIZED_IS_SPLINE =
  "Material-3 `emphasized` is a two-segment spline (PathInterpolator), not a single cubic-bezier; validate it as a spline.";

/** Advisory: warn for any duration not on a reference ladder (default M3). */
export function checkDurationLadder(values: number[], ladder: readonly number[] = M3_DURATIONS): TokenIssue[] {
  const set = new Set(ladder);
  return values
    .filter((v) => !set.has(v))
    .map((v) => ({ level: "warning" as const, token: "motion", message: `duration ${v}ms is not on the reference ladder` }));
}

/** Assert a cubic-bezier matches an expected 4-tuple within tolerance. */
export function checkEasingMatch(
  value: unknown,
  expected: [number, number, number, number],
  opts: { tolerance?: number; label?: string } = {},
): TokenIssue[] {
  const tol = opts.tolerance ?? 0.02;
  const label = opts.label ?? "easing";
  if (!Array.isArray(value) || value.length !== 4 || !value.every((n) => typeof n === "number")) {
    return [{ level: "error", token: label, message: "easing must be a cubic-bezier 4-tuple" }];
  }
  const off = (value as number[]).some((n, i) => Math.abs(n - expected[i]!) > tol);
  return off ? [{ level: "warning", token: label, message: `easing ${JSON.stringify(value)} deviates from reference ${JSON.stringify(expected)}` }] : [];
}
