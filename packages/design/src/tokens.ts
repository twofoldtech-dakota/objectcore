// ObjectCore — @objectcore/design domain types.
//
// These mirror the W3C Design Tokens Community Group (DTCG) Format Module 2025.10
// — the first STABLE version (2025-10-28), vendor-neutral machine-readable JSON.
// This package is the pure, dependency-free core of the design-system factory, the
// exact discipline registry-core uses for the catalog: a token is a JSON object
// identified by a `$value`, carrying a `$type` drawn from a FIXED set of 13 types
// that tools MUST validate values against and MUST NOT infer. Read the doc comments
// — they encode spec rules (hard format errors), not style. See plans/012.

/** The 13 DTCG token types. Every design token MUST resolve to one of these. */
export type TokenType =
  | "color"
  | "dimension"
  | "fontFamily"
  | "fontWeight"
  | "duration"
  | "cubicBezier"
  | "number"
  | "strokeStyle"
  | "border"
  | "transition"
  | "shadow"
  | "gradient"
  | "typography";

/** The closed 13-type set, for membership checks. (§8.8 flags FUTURE additions
 *  — font style, percentage/ratio, file — deliberately excluded until normative.) */
export const TOKEN_TYPES: readonly TokenType[] = [
  "color",
  "dimension",
  "fontFamily",
  "fontWeight",
  "duration",
  "cubicBezier",
  "number",
  "strokeStyle",
  "border",
  "transition",
  "shadow",
  "gradient",
  "typography",
];

/** DTCG Color Module 2025.10 color spaces — incl. the perceptual spaces (oklch/lch)
 *  the design layer authors in, plus wide-gamut (display-p3) and CSS Color 4. */
export type ColorSpace =
  | "srgb"
  | "srgb-linear"
  | "hsl"
  | "hwb"
  | "lab"
  | "lch"
  | "oklab"
  | "oklch"
  | "display-p3"
  | "a98-rgb"
  | "prophoto-rgb"
  | "rec2020"
  | "xyz-d65"
  | "xyz-d50";

export const COLOR_SPACES: readonly ColorSpace[] = [
  "srgb",
  "srgb-linear",
  "hsl",
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "display-p3",
  "a98-rgb",
  "prophoto-rgb",
  "rec2020",
  "xyz-d65",
  "xyz-d50",
];

// ── Canonical composite value shapes (2025.10). A sub-value MAY instead be a
//    `{group.token}` Reference, resolved later by resolve.ts. ────────────────

/** `{group.subgroup.token}` — always resolves to the whole target `$value`. */
export type Reference = string;

/** 2025.10 structured color: `{ colorSpace, components }` (+ optional alpha/hex).
 *  A bare hex/CSS string is also accepted by the validator as an authoring form. */
export interface ColorValue {
  colorSpace: ColorSpace;
  components: Array<number | "none">;
  alpha?: number;
  hex?: string;
}

/** 2025.10 made dimension an OBJECT (not a `"16px"` string): value + unit. */
export interface DimensionValue {
  value: number;
  unit: "px" | "rem";
}

/** 2025.10 duration object: value + unit. */
export interface DurationValue {
  value: number;
  unit: "ms" | "s";
}

/** Four control points `[x1, y1, x2, y2]`; x-coords are clamped to [0, 1]. */
export type CubicBezierValue = [number, number, number, number];

export interface BorderValue {
  color: ColorValue | Reference;
  width: DimensionValue | Reference;
  style: StrokeStyleValue | Reference;
}

export type StrokeStyleValue =
  | "solid" | "dashed" | "dotted" | "double" | "groove" | "ridge" | "outset" | "inset"
  | { dashArray: Array<DimensionValue | Reference>; lineCap: "round" | "butt" | "square" };

export interface TransitionValue {
  duration: DurationValue | Reference;
  delay: DurationValue | Reference;
  timingFunction: CubicBezierValue | Reference;
}

export interface ShadowValue {
  color: ColorValue | Reference;
  offsetX: DimensionValue | Reference;
  offsetY: DimensionValue | Reference;
  blur: DimensionValue | Reference;
  spread: DimensionValue | Reference;
  inset?: boolean;
}

export interface GradientStop {
  color: ColorValue | Reference;
  position: number;
}

export interface TypographyValue {
  fontFamily: string | string[] | Reference;
  fontSize: DimensionValue | Reference;
  fontWeight: number | string | Reference;
  letterSpacing: DimensionValue | Reference;
  lineHeight: number | Reference;
}

// ── The token tree ──────────────────────────────────────────────────────────

/** The reserved `$`-prefixed properties a token or group MAY carry. Any OTHER
 *  `$`-prefixed key is a format error (reject-unknown, like registry-core schema). */
export const RESERVED_PROPS = ["$value", "$type", "$description", "$extensions", "$deprecated"] as const;

/** A design token: identified by the presence of `$value`. */
export interface DesignToken {
  /** REQUIRED. The token's value, OR a `{ref}` to another token's value. */
  $value: unknown;
  /** Required unless inherited from a parent group or resolved via a reference. */
  $type?: TokenType;
  $description?: string;
  $extensions?: Record<string, unknown>;
  $deprecated?: boolean | string;
}

/** A group: a node WITHOUT `$value`. `$type` set here is inherited by descendants.
 *  Non-`$` keys are child tokens or groups. Modeled loosely for traversal — the
 *  validator narrows at runtime via `isToken`/`isGroup`. */
export type TokenTree = { [key: string]: unknown };

/** A fully-resolved token (aliases followed to concrete values), keyed by dotted
 *  path — the form derive.ts / the gates consume. */
export interface ResolvedToken {
  /** Dotted path, e.g. `color.accent.9`. */
  path: string;
  type: TokenType;
  /** Concrete value with all `{refs}` substituted. */
  value: unknown;
  description?: string;
  /** The token's OWN `$extensions`, passed through verbatim — never inherited from
   *  a group and never resolved through a reference (an alias keeps its own, not
   *  its target's). Vendor data like provenance rides here (plan 014). */
  extensions?: Record<string, unknown>;
}

// ── Guards / helpers (pure) ───────────────────────────────────────────────────

/** A `$value` (or composite sub-value) that is a `{group.token}` alias reference. */
export function isReference(v: unknown): v is Reference {
  return typeof v === "string" && /^\{[^{}]+\}$/.test(v.trim());
}

/** The dotted path inside a `{a.b.c}` reference (no braces). */
export function referencePath(ref: Reference): string {
  return ref.trim().slice(1, -1);
}

/** A node is a TOKEN iff it is a plain object carrying its own `$value`. */
export function isToken(node: unknown): node is DesignToken {
  return typeof node === "object" && node !== null && !Array.isArray(node) && "$value" in node;
}

/** A node is a GROUP iff it is a plain object WITHOUT `$value`. */
export function isGroup(node: unknown): node is TokenTree {
  return typeof node === "object" && node !== null && !Array.isArray(node) && !("$value" in node);
}
