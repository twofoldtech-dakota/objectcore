// The DTCG grammar floor — the design-token analogue of registry-core's
// `validateSchema`. Hand-rolled (zero-dep) on purpose: this package is the pure
// seam and stays dependency-free, exactly like registry-core hand-rolls its
// kebab regex. It asserts what the DTCG 2025.10 Format Module makes MUSTs:
//   (a) a token has a `$value`;
//   (b) its `$type` is resolvable (own → inherited from a parent group → deferred
//       to a reference target) and is one of the fixed 13 types;
//   (c) the value's SHAPE matches the declared `$type` ("Tools MUST NOT guess the
//       type by inspecting the value"); and
//   (d) only the reserved `$`-props appear (reject-unknown, like the manifest schema).
// Reference resolution + cycle detection live in resolve.ts; this is structural.

import type { TokenType } from "./tokens";
import {
  TOKEN_TYPES,
  COLOR_SPACES,
  RESERVED_PROPS,
  isReference,
  isToken,
} from "./tokens";

export interface TokenIssue {
  level: "error" | "warning";
  /** Dotted token/group path, e.g. `color.accent.9`. */
  token?: string;
  message: string;
}

const FONT_WEIGHT_KEYWORDS = new Set([
  "thin", "hairline", "extra-light", "ultra-light", "light", "normal", "regular",
  "book", "medium", "semi-bold", "demi-bold", "bold", "extra-bold", "ultra-bold",
  "black", "heavy",
]);

const STROKE_KEYWORDS = new Set([
  "solid", "dashed", "dotted", "double", "groove", "ridge", "outset", "inset",
]);

const RESERVED = new Set<string>(RESERVED_PROPS);

const isFinite_ = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Wrap a concrete-value check so an alias `{ref}` is always accepted in its place
 *  (the reference resolves to a value validated at ITS definition site). */
const refOr = (check: (v: unknown) => string | null) => (v: unknown): string | null =>
  isReference(v) ? null : check(v);

// ── Per-type value-shape validators (return an error message or null) ─────────

function checkColor(v: unknown): string | null {
  // Authoring form: a bare hex / CSS color string.
  if (typeof v === "string") return v.trim() ? null : "color string must be non-empty";
  if (!isObj(v)) return "color must be a string or `{ colorSpace, components }` object";
  if (typeof v.colorSpace !== "string" || !COLOR_SPACES.includes(v.colorSpace as never))
    return `color.colorSpace must be one of: ${COLOR_SPACES.join(", ")}`;
  if (!Array.isArray(v.components) || !v.components.every((c) => isFinite_(c) || c === "none"))
    return "color.components must be an array of numbers (or \"none\")";
  if (v.alpha !== undefined && (!isFinite_(v.alpha) || v.alpha < 0 || v.alpha > 1))
    return "color.alpha must be a number in [0, 1]";
  if (v.hex !== undefined && typeof v.hex !== "string")
    return "color.hex must be a string";
  return null;
}

function checkDimension(v: unknown): string | null {
  if (!isObj(v)) return "dimension must be a `{ value, unit }` object (2025.10)";
  if (!isFinite_(v.value)) return "dimension.value must be a number";
  if (v.unit !== "px" && v.unit !== "rem") return 'dimension.unit must be "px" or "rem"';
  return null;
}

function checkDuration(v: unknown): string | null {
  if (!isObj(v)) return "duration must be a `{ value, unit }` object";
  if (!isFinite_(v.value) || v.value < 0) return "duration.value must be a number >= 0";
  if (v.unit !== "ms" && v.unit !== "s") return 'duration.unit must be "ms" or "s"';
  return null;
}

function checkFontFamily(v: unknown): string | null {
  if (typeof v === "string") return v.trim() ? null : "fontFamily string must be non-empty";
  if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string")) return null;
  return "fontFamily must be a string or non-empty array of strings";
}

function checkFontWeight(v: unknown): string | null {
  if (typeof v === "string") {
    return FONT_WEIGHT_KEYWORDS.has(v) ? null : `fontWeight keyword must be one of the DTCG aliases`;
  }
  if (isFinite_(v) && Number.isInteger(v) && v >= 1 && v <= 1000) return null;
  return "fontWeight must be an integer in [1, 1000] or a known keyword";
}

function checkCubicBezier(v: unknown): string | null {
  if (!Array.isArray(v) || v.length !== 4 || !v.every(isFinite_))
    return "cubicBezier must be an array of 4 numbers";
  if ((v[0] as number) < 0 || (v[0] as number) > 1 || (v[2] as number) < 0 || (v[2] as number) > 1)
    return "cubicBezier x-coordinates (indices 0 and 2) must be in [0, 1]";
  return null;
}

function checkNumber(v: unknown): string | null {
  return isFinite_(v) ? null : "number must be a finite number";
}

function checkStrokeStyle(v: unknown): string | null {
  if (typeof v === "string") return STROKE_KEYWORDS.has(v) ? null : "strokeStyle keyword is not recognized";
  if (!isObj(v)) return "strokeStyle must be a keyword or `{ dashArray, lineCap }` object";
  if (!Array.isArray(v.dashArray)) return "strokeStyle.dashArray must be an array of dimensions";
  for (const d of v.dashArray) { const e = refOr(checkDimension)(d); if (e) return `strokeStyle.dashArray: ${e}`; }
  if (v.lineCap !== "round" && v.lineCap !== "butt" && v.lineCap !== "square")
    return 'strokeStyle.lineCap must be "round", "butt", or "square"';
  return null;
}

/** Validate that `obj` is an object whose named fields each pass their checker. */
function checkShape(label: string, obj: unknown, fields: Record<string, (v: unknown) => string | null>): string | null {
  if (!isObj(obj)) return `${label} must be an object`;
  for (const [name, check] of Object.entries(fields)) {
    if (!(name in obj)) return `${label} is missing \`${name}\``;
    const e = check(obj[name]);
    if (e) return `${label}.${name}: ${e}`;
  }
  return null;
}

function checkBorder(v: unknown): string | null {
  return checkShape("border", v, {
    color: refOr(checkColor),
    width: refOr(checkDimension),
    style: refOr(checkStrokeStyle),
  });
}

function checkTransition(v: unknown): string | null {
  return checkShape("transition", v, {
    duration: refOr(checkDuration),
    delay: refOr(checkDuration),
    timingFunction: refOr(checkCubicBezier),
  });
}

function checkOneShadow(v: unknown): string | null {
  if (isReference(v)) return null;
  const e = checkShape("shadow", v, {
    color: refOr(checkColor),
    offsetX: refOr(checkDimension),
    offsetY: refOr(checkDimension),
    blur: refOr(checkDimension),
    spread: refOr(checkDimension),
  });
  if (e) return e;
  const inset = (v as Record<string, unknown>).inset;
  if (inset !== undefined && typeof inset !== "boolean") return "shadow.inset must be a boolean";
  return null;
}

function checkShadow(v: unknown): string | null {
  // A single shadow OR a layered array of them.
  if (Array.isArray(v)) {
    if (v.length === 0) return "shadow array must be non-empty";
    for (const s of v) { const e = checkOneShadow(s); if (e) return e; }
    return null;
  }
  return checkOneShadow(v);
}

function checkGradient(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0) return "gradient must be a non-empty array of stops";
  for (const stop of v) {
    if (isReference(stop)) continue;
    if (!isObj(stop)) return "gradient stop must be a `{ color, position }` object";
    const ce = refOr(checkColor)(stop.color);
    if (ce) return `gradient stop.color: ${ce}`;
    if (!isReference(stop.position) && (!isFinite_(stop.position) || stop.position < 0 || stop.position > 1))
      return "gradient stop.position must be a number in [0, 1]";
  }
  return null;
}

function checkTypography(v: unknown): string | null {
  return checkShape("typography", v, {
    fontFamily: refOr(checkFontFamily),
    fontSize: refOr(checkDimension),
    fontWeight: refOr(checkFontWeight),
    letterSpacing: refOr(checkDimension),
    lineHeight: refOr((x) => (isFinite_(x) ? null : "lineHeight must be a number")),
  });
}

const TYPE_VALIDATORS: Record<TokenType, (v: unknown) => string | null> = {
  color: checkColor,
  dimension: checkDimension,
  fontFamily: checkFontFamily,
  fontWeight: checkFontWeight,
  duration: checkDuration,
  cubicBezier: checkCubicBezier,
  number: checkNumber,
  strokeStyle: checkStrokeStyle,
  border: checkBorder,
  transition: checkTransition,
  shadow: checkShadow,
  gradient: checkGradient,
  typography: checkTypography,
};

// ── The walk ──────────────────────────────────────────────────────────────────

/** Validate the `$`-props common to a token or group (unknown props, valid `$type`). */
function checkReservedProps(node: Record<string, unknown>, path: string, issues: TokenIssue[]): void {
  for (const key of Object.keys(node)) {
    if (!key.startsWith("$")) continue;
    if (!RESERVED.has(key)) {
      issues.push({ level: "error", token: path, message: `unknown reserved property \`${key}\`` });
    }
  }
  if (node.$type !== undefined && !TOKEN_TYPES.includes(node.$type as TokenType)) {
    issues.push({ level: "error", token: path, message: `\`$type\` must be one of the 13 DTCG types, got \`${String(node.$type)}\`` });
  }
}

function validateToken(node: Record<string, unknown>, path: string, inheritedType: TokenType | undefined, issues: TokenIssue[]): void {
  // A token must not also contain child tokens/groups.
  for (const key of Object.keys(node)) {
    if (!key.startsWith("$")) {
      issues.push({ level: "error", token: path, message: `a token cannot contain a child \`${key}\` (move it to a sibling group)` });
    }
  }
  const ownType = TOKEN_TYPES.includes(node.$type as TokenType) ? (node.$type as TokenType) : undefined;
  const effectiveType = ownType ?? inheritedType;
  const value = node.$value;

  // A pure alias defers BOTH type and shape to its target (checked in resolve.ts).
  if (isReference(value)) return;

  if (!effectiveType) {
    issues.push({ level: "error", token: path, message: "cannot determine `$type` (set it here or on a parent group)" });
    return;
  }
  const err = TYPE_VALIDATORS[effectiveType](value);
  if (err) issues.push({ level: "error", token: path, message: err });
}

function walk(node: Record<string, unknown>, path: string, inheritedType: TokenType | undefined, issues: TokenIssue[]): void {
  checkReservedProps(node, path, issues);

  if (isToken(node)) {
    validateToken(node, path, inheritedType, issues);
    return;
  }

  // It's a group: `$type` here is inherited by descendants.
  const groupType = TOKEN_TYPES.includes(node.$type as TokenType) ? (node.$type as TokenType) : inheritedType;
  for (const [name, child] of Object.entries(node)) {
    if (name.startsWith("$")) continue; // reserved prop, already handled
    const childPath = path ? `${path}.${name}` : name;
    if (/[.{}]/.test(name)) {
      issues.push({ level: "error", token: childPath, message: "token/group names must not contain `.`, `{`, or `}`" });
    }
    if (typeof child !== "object" || child === null || Array.isArray(child)) {
      issues.push({ level: "error", token: childPath, message: "must be a token or group object" });
      continue;
    }
    walk(child as Record<string, unknown>, childPath, groupType, issues);
  }
}

/** Strict structural validation of a DTCG token tree. Pure; never throws. */
export function validateTokens(tree: Record<string, unknown>): TokenIssue[] {
  const issues: TokenIssue[] = [];
  if (typeof tree !== "object" || tree === null || Array.isArray(tree)) {
    return [{ level: "error", message: "token document must be a JSON object" }];
  }
  walk(tree, "", undefined, issues);
  return issues;
}
