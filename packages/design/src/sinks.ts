// Sink adapters. The port is `TokenSink`: it serializes a derived design system
// into platform output (the analogue of registry-core's `CatalogSink`). `CssVarSink`
// emits CSS custom properties (`:root` + `[data-theme="…"]` — the standard custom-
// property theming pattern); `JsonSink` emits a flat path→value map per theme;
// `TailwindThemeSink` emits a Tailwind v4 CSS-first `@theme` config; and
// `StyleDictionarySink` emits Amazon Style Dictionary's source format (see each
// class header). The core stays hand-rolled + zero-dep (Decision A): every adapter
// emits the format a downstream tool consumes — we never depend on the tool itself.
// Pure; never throws.

import type { DesignSystemOutput, DerivedTheme } from "./derive";
import type { ResolvedToken, TokenType } from "./tokens";

export interface SinkFile {
  path: string;
  content: string;
}

export interface TokenSink {
  emit(output: DesignSystemOutput): SinkFile[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const CSS_FUNCTION_SPACES = new Set(["oklch", "oklab", "lch", "lab", "hsl", "hwb"]);

/** A resolved color value → a CSS color string (functional/`color()` form, or a
 *  passthrough for an authored hex/CSS string). */
function colorToCss(v: unknown): string {
  if (typeof v === "string") return v;
  if (isObj(v) && typeof v.colorSpace === "string" && Array.isArray(v.components)) {
    const comps = v.components.map((c) => (c === "none" ? "none" : String(c))).join(" ");
    const alpha = typeof v.alpha === "number" ? ` / ${v.alpha}` : "";
    return CSS_FUNCTION_SPACES.has(v.colorSpace)
      ? `${v.colorSpace}(${comps}${alpha})`
      : `color(${v.colorSpace} ${comps}${alpha})`;
  }
  return String(v);
}

const dimToCss = (v: unknown): string =>
  isObj(v) && typeof v.value === "number" ? `${v.value}${v.unit}` : String(v);

const durToCss = (v: unknown): string =>
  isObj(v) && typeof v.value === "number" ? `${v.value}${v.unit}` : String(v);

/** DTCG strokeStyle → CSS. The object form ({ dashArray, lineCap }) has no CSS
 *  border-style equivalent, so it maps to the nearest keyword, `dashed` — never an
 *  empty declaration or "[object Object]". */
const strokeToCss = (v: unknown): string =>
  typeof v === "string" ? v : isObj(v) && Array.isArray(v.dashArray) ? "dashed" : String(v);

const familyToCss = (v: unknown): string => {
  const quote = (f: string) => (/\s/.test(f) ? `"${f}"` : f);
  if (Array.isArray(v)) return v.map((f) => quote(String(f))).join(", ");
  return String(v);
};

/** Serialize one resolved token to one OR MORE `(varSuffix, cssValue)` pairs.
 *  Scalars yield one pair; the typography composite expands into sub-vars. */
function cssPairs(token: ResolvedToken): Array<[string, string]> {
  const v = token.value;
  switch (token.type) {
    case "color":
      return [["", colorToCss(v)]];
    case "dimension":
      return [["", dimToCss(v)]];
    case "duration":
      return [["", durToCss(v)]];
    case "number":
      return [["", String(v)]];
    case "fontWeight":
      return [["", String(v)]];
    case "fontFamily":
      return [["", familyToCss(v)]];
    case "cubicBezier":
      return Array.isArray(v) ? [["", `cubic-bezier(${v.join(", ")})`]] : [["", String(v)]];
    case "strokeStyle":
      return [["", strokeToCss(v)]];
    case "border":
      return isObj(v) ? [["", `${dimToCss(v.width)} ${strokeToCss(v.style)} ${colorToCss(v.color)}`]] : [["", String(v)]];
    case "transition":
      return isObj(v)
        ? [["", `${durToCss(v.duration)} cubic-bezier(${Array.isArray(v.timingFunction) ? v.timingFunction.join(", ") : v.timingFunction}) ${durToCss(v.delay)}`]]
        : [["", String(v)]];
    case "shadow":
      return [["", shadowToCss(v)]];
    case "gradient":
      return [["", gradientToCss(v)]];
    case "typography":
      return isObj(v)
        ? [
            ["-font-family", familyToCss(v.fontFamily)],
            ["-font-size", dimToCss(v.fontSize)],
            ["-font-weight", String(v.fontWeight)],
            ["-letter-spacing", dimToCss(v.letterSpacing)],
            ["-line-height", String(v.lineHeight)],
          ]
        : [["", String(v)]];
    default:
      return [["", String(v)]];
  }
}

function oneShadowToCss(s: unknown): string {
  if (!isObj(s)) return String(s);
  const inset = s.inset === true ? "inset " : "";
  return `${inset}${dimToCss(s.offsetX)} ${dimToCss(s.offsetY)} ${dimToCss(s.blur)} ${dimToCss(s.spread)} ${colorToCss(s.color)}`;
}
const shadowToCss = (v: unknown): string =>
  Array.isArray(v) ? v.map(oneShadowToCss).join(", ") : oneShadowToCss(v);

function gradientToCss(v: unknown): string {
  if (!Array.isArray(v)) return String(v);
  const stops = v.map((s) => (isObj(s) ? `${colorToCss(s.color)} ${Number(s.position) * 100}%` : String(s)));
  return `linear-gradient(${stops.join(", ")})`;
}

/** `color.accent.9` → `--color-accent-9`. */
const cssVarName = (path: string): string => `--${path.replace(/\./g, "-")}`;

function themeBlock(theme: DerivedTheme): string {
  const lines: string[] = [];
  for (const token of theme.tokens) {
    for (const [suffix, value] of cssPairs(token)) {
      lines.push(`  ${cssVarName(token.path)}${suffix}: ${value};`);
    }
  }
  return lines.join("\n");
}

/** Emits a single `tokens.css`: the first theme under `:root`, each subsequent theme
 *  under `[data-theme="<name>"]` (the CSS custom-property theming pattern). */
export class CssVarSink implements TokenSink {
  constructor(private readonly fileName = "tokens.css") {}

  emit(output: DesignSystemOutput): SinkFile[] {
    const blocks: string[] = [];
    output.themes.forEach((theme, i) => {
      const selector = i === 0 ? ":root" : `[data-theme="${theme.name}"]`;
      blocks.push(`${selector} {\n${themeBlock(theme)}\n}`);
    });
    return [{ path: this.fileName, content: blocks.join("\n\n") + "\n" }];
  }
}

/** Emits one `<theme>.tokens.json` per theme: a flat dotted-path → resolved-value map. */
export class JsonSink implements TokenSink {
  emit(output: DesignSystemOutput): SinkFile[] {
    return output.themes.map((theme) => ({
      path: `${theme.name}.tokens.json`,
      content: JSON.stringify(Object.fromEntries(theme.tokens.map((t) => [t.path, t.value])), null, 2) + "\n",
    }));
  }
}

// ── Tailwind v4 `@theme` sink ─────────────────────────────────────────────────
//
// Projects the derived system into Tailwind v4's CSS-first theme config. A token's
// `$type` (and, for `dimension`, its path) selects the Tailwind theme NAMESPACE
// (`--color-*`, `--spacing-*`, `--radius-*`, `--text-*`, `--font-*`,
// `--font-weight-*`, `--ease-*`, `--shadow-*`), so each token generates the matching
// utilities (`bg-…`/`text-…`/`border-…`, `p-…`/`gap-…`, `rounded-…`, `text-…`,
// `font-…`, `ease-…`). The light/dark split is handled the v4 way:
//   • theme-INVARIANT tokens (value identical across every theme — the primitive
//     palette, spacing, radius, fonts, sizes, weights, easings) go in `@theme`;
//   • themeable tokens (value VARIES across themes — the semantic light/dark colors)
//     go in `@theme inline`, where the namespaced var points at a mode-switched
//     custom property (`--color-bg-canvas: var(--bg-canvas)`), and the raw values
//     live under `:root` / `[data-theme="…"]`. `@theme inline` makes the generated
//     utilities reference that inner var, so they follow `data-theme` at runtime —
//     the documented v4 runtime-theming idiom.
// Semantic color tokens keep their FULL path (`bg.canvas` → `--color-bg-canvas`):
// the role group stays in the name so distinct tokens can't collide (e.g.
// `border.subtle` vs `text.subtle`). Types Tailwind has no namespace for (duration,
// number, the composites) fall back to plain custom properties — still emitted, so
// usable via `var()` / arbitrary values, just without generated utilities.

/** Tailwind v4 theme namespace + the name within it, or null when the token has no
 *  Tailwind utility namespace (→ emitted as a plain custom property). */
interface TailwindSlot {
  namespace: string;
  name: string;
}

const kebabPath = (path: string): string => path.replace(/\./g, "-");

/** `afterPrefix("font.size.lg", "font.size")` → `"lg"`; non-match → null. */
function afterPrefix(path: string, prefix: string): string | null {
  if (path === prefix) return "";
  return path.startsWith(prefix + ".") ? path.slice(prefix.length + 1) : null;
}

/** Map a resolved token to its Tailwind `@theme` namespace, or null when unmapped. */
function tailwindSlot(token: ResolvedToken): TailwindSlot | null {
  const p = token.path;
  switch (token.type) {
    case "color": {
      // Primitive palette lives under `color.*`; strip it so `color.accent.light.9`
      // → `--color-accent-light-9`. Semantic colors keep their full path.
      const primitive = afterPrefix(p, "color");
      return { namespace: "color", name: kebabPath(primitive !== null ? primitive : p) };
    }
    case "dimension": {
      const size = afterPrefix(p, "font.size");
      if (size !== null) return { namespace: "text", name: kebabPath(size) };
      const space = afterPrefix(p, "space");
      if (space !== null) return { namespace: "spacing", name: kebabPath(space) };
      const radius = afterPrefix(p, "radius");
      if (radius !== null) return { namespace: "radius", name: kebabPath(radius) };
      return { namespace: "spacing", name: kebabPath(p) };
    }
    case "fontFamily": {
      const f = afterPrefix(p, "font.family");
      return { namespace: "font", name: kebabPath(f !== null ? f : p) };
    }
    case "fontWeight": {
      const w = afterPrefix(p, "font.weight");
      return { namespace: "font-weight", name: kebabPath(w !== null ? w : p) };
    }
    case "cubicBezier": {
      const e = afterPrefix(p, "motion.easing");
      return { namespace: "ease", name: kebabPath(e !== null ? e : p) };
    }
    case "shadow": {
      const s = afterPrefix(p, "shadow");
      return { namespace: "shadow", name: kebabPath(s !== null ? s : p) };
    }
    default:
      // duration, number, strokeStyle, border, transition, gradient, typography
      return null;
  }
}

/** A token rendered to declarations: the canonical `@theme` form, the raw custom
 *  properties (for per-theme overrides), the namespaced var name when it maps to a
 *  single utility slot, and an equality key for the invariance check across themes. */
interface RenderedToken {
  decls: Array<[string, string]>;
  rawDecls: Array<[string, string]>;
  slotVar: string | null;
  rawVar: string | null;
  key: string;
}

function renderToken(token: ResolvedToken): RenderedToken {
  const pairs = cssPairs(token);
  const rawDecls = pairs.map(([suffix, value]) => [cssVarName(token.path) + suffix, value] as [string, string]);
  const slot = tailwindSlot(token);
  const scalar = pairs.length === 1 && pairs[0]![0] === "";
  if (slot && scalar) {
    const slotVar = `--${slot.namespace}-${slot.name}`;
    return { decls: [[slotVar, pairs[0]![1]]], rawDecls, slotVar, rawVar: cssVarName(token.path), key: pairs[0]![1] };
  }
  // Unmapped or composite: the canonical form IS the raw custom properties.
  return { decls: rawDecls, rawDecls, slotVar: null, rawVar: null, key: rawDecls.map((d) => d.join("=")).join(";") };
}

/** Emits a single Tailwind v4 `theme.css`: an `@theme` block of invariant tokens,
 *  an `@theme inline` block for themeable (light/dark) colors, and per-theme
 *  `:root` / `[data-theme="…"]` blocks holding the mode-switched raw values. */
export class TailwindThemeSink implements TokenSink {
  constructor(private readonly fileName = "theme.css") {}

  emit(output: DesignSystemOutput): SinkFile[] {
    const themes = output.themes;
    const perTheme = themes.map((t) => new Map(t.tokens.map((tok) => [tok.path, renderToken(tok)])));

    // Stable path order: first-seen across themes (input order is deterministic).
    const order: string[] = [];
    const seen = new Set<string>();
    for (const m of perTheme) for (const path of m.keys()) if (!seen.has(path)) (seen.add(path), order.push(path));

    const themeLines: string[] = []; // @theme { } — invariant
    const inlineLines: string[] = []; // @theme inline { } — themeable namespaced → var(raw)
    const selectorLines: string[][] = themes.map(() => []); // per-theme raw overrides

    for (const path of order) {
      const renders = perTheme.map((m) => m.get(path));
      const present = renders.filter((r): r is RenderedToken => r !== undefined);
      const base = present[0]!;
      const invariant = present.length === themes.length && present.every((r) => r.key === base.key);

      if (invariant) {
        for (const [name, value] of base.decls) themeLines.push(`  ${name}: ${value};`);
        continue;
      }
      // Themeable: point the namespaced utility var at a mode-switched custom property,
      // then emit that property's per-theme value under each selector.
      if (base.slotVar && base.rawVar) inlineLines.push(`  ${base.slotVar}: var(${base.rawVar});`);
      renders.forEach((r, i) => {
        if (r) for (const [name, value] of r.rawDecls) selectorLines[i]!.push(`  ${name}: ${value};`);
      });
    }

    const blocks: string[] = [`@theme {\n${themeLines.join("\n")}\n}`];
    if (inlineLines.length) blocks.push(`@theme inline {\n${inlineLines.join("\n")}\n}`);
    themes.forEach((theme, i) => {
      if (!selectorLines[i]!.length) return;
      const selector = i === 0 ? ":root" : `[data-theme="${theme.name}"]`;
      blocks.push(`${selector} {\n${selectorLines[i]!.join("\n")}\n}`);
    });
    return [{ path: this.fileName, content: blocks.join("\n\n") + "\n" }];
  }
}

// ── Style Dictionary sink ─────────────────────────────────────────────────────
//
// Projects the derived system into Amazon Style Dictionary's classic source format:
// a NESTED token tree whose leaves are `{ "value": <css string>, "type": <dtcg type> }`,
// one file per theme (`<theme>.sd.json`). It emits the RESOLVED, theme-specific tokens,
// so a downstream `style-dictionary build` can transform them to any platform (iOS,
// Android, JS, …) WITHOUT re-implementing our alias/theming resolver. This stays a
// pure, zero-dep handoff: we emit the format SD consumes, we don't depend on
// `style-dictionary` itself. Values are CSS strings — web-ready immediately; oklch
// colors would need a hex-emitting upstream for SD's native-platform color transforms
// (the same "richer platforms are optional" caveat). The classic `value`/`type` shape
// is read by both Style Dictionary v3 and v4. Pure; never throws.

type SdLeaf = { value: string; type: TokenType };
type SdNode = SdLeaf | { [key: string]: SdNode };

/** Sub-token `$type`s for the one composite that expands (typography); other
 *  composites (border/shadow/gradient/transition) serialize to a single CSS string. */
const TYPOGRAPHY_SUBTYPE: Record<string, TokenType> = {
  "font-family": "fontFamily",
  "font-size": "dimension",
  "font-weight": "fontWeight",
  "letter-spacing": "dimension",
  "line-height": "number",
};

/** One resolved token → a Style Dictionary node: a `{ value, type }` leaf for a
 *  scalar, or a group of sub-leaves for the typography composite. */
function styleDictionaryNode(token: ResolvedToken): SdNode {
  const pairs = cssPairs(token);
  if (pairs.length === 1 && pairs[0]![0] === "") {
    return { value: pairs[0]![1], type: token.type };
  }
  const group: { [key: string]: SdNode } = {};
  for (const [suffix, value] of pairs) {
    const key = suffix.replace(/^-/, "");
    group[key] = { value, type: TYPOGRAPHY_SUBTYPE[key] ?? token.type };
  }
  return group;
}

/** Insert `leaf` at the dotted `path` into a nested object tree, rebuilding groups. */
function setNested(root: { [key: string]: SdNode }, path: string, leaf: SdNode): void {
  const segments = path.split(".");
  let node: { [key: string]: SdNode } = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    const next = node[seg];
    if (next === undefined || typeof next !== "object" || "value" in next) node[seg] = {};
    node = node[seg] as { [key: string]: SdNode };
  }
  node[segments[segments.length - 1]!] = leaf;
}

/** Emits one `<theme>.sd.json` per theme: the resolved tokens as a nested Style
 *  Dictionary source tree (`{ value, type }` leaves), ready for an SD `source` glob. */
export class StyleDictionarySink implements TokenSink {
  emit(output: DesignSystemOutput): SinkFile[] {
    return output.themes.map((theme) => {
      const tree: { [key: string]: SdNode } = {};
      for (const token of theme.tokens) setNested(tree, token.path, styleDictionaryNode(token));
      return { path: `${theme.name}.sd.json`, content: JSON.stringify(tree, null, 2) + "\n" };
    });
  }
}
