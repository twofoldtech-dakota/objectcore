// The spec page (plan 014) — the system's generated SPECIMEN: one self-contained,
// interactive HTML page (theme switcher, click-to-copy ramps, role docs, side-by-side
// parity panes, a rooms gallery, and a measured contrast-proof table) per design
// system. "Measured, not promised" as a build artifact: the proof table renders ONLY
// injected `proveContrast` entries — the gate's own numbers, never a second
// computation. The page chrome consumes the system's OWN CSS variables with fallback
// chains (`var(--bg-base, var(--bg-canvas, …))`), so both the wide 014 contract and
// the narrow legacy vocabulary render. Everything the engine writes without `SpecCopy`
// is factual (counts, measurements, role names); editorial voice comes only from copy.
// Deterministic — no Date.now/Math.random; two renders are byte-identical. All
// interpolated prose is HTML-escaped; the embedded data island escapes `<` so a
// `</script>` can never break out. Pure; never throws.

import type { DesignSystemOutput, DesignSystemSource, DerivedTheme } from "./derive";
import type { SinkFile, TokenSink } from "./sinks";
import { colorToCss, themeDecls } from "./sinks";
import type { ProofEntry } from "./proof";
import type { DesignBrief } from "./judge";
import { relativeLuminance } from "./color";
import { flattenTokens } from "./resolve";
import { isReference, referencePath } from "./tokens";
import { applyResolver, mergeTrees } from "./theme";

/** The vendor `$extensions` key carrying derivation provenance (plan 014). A truthy
 *  `source` marks a value recorded verbatim at the source (the ramp dot); a string
 *  carries the note itself. */
export const DERIVED_EXTENSION = "ai.objectcore.derived";

/** Editorial voice for the spec page — the ONLY source of non-factual prose
 *  (per-preset `spec-copy.json`, or hand-authored next to a scaffolded system). */
export interface SpecCopy {
  /** Display title (default: the system name). */
  title?: string;
  /** The hero eyebrow line (default: factual counts). */
  kicker?: string;
  /** The hero standfirst (default: the brief's intent, when given). */
  tagline?: string;
  /** Principle cards; the whole section is OMITTED when absent. */
  principles?: Array<{ title: string; body: string }>;
  /** Per-ramp-family notes, keyed by family (e.g. `"neutral"`). */
  rampNotes?: Record<string, string>;
  /** Per-role notes, keyed by role path (e.g. `"accent.default"`). */
  roleNotes?: Record<string, string>;
  /** The stylesheet name the adoption section points at (default `"tokens.css"`). */
  adoptionFileName?: string;
}

export interface SpecInput {
  /** System name (`design/<name>`). */
  system: string;
  output: DesignSystemOutput;
  /** The measured contract (`proveContrast`) — the proof table's ONLY data source;
   *  the section is omitted when absent. */
  proof?: ProofEntry[];
  /** Per-theme `path → referenced path` map (`specProvenance`) — role provenance. */
  provenance?: Record<string, Record<string, string>>;
  copy?: SpecCopy;
  brief?: DesignBrief;
}

// ── Data extraction (pure) ────────────────────────────────────────────────────

export interface SpecRampStep {
  /** The numeric step name, e.g. `"50"` or `"9"`. */
  step: string;
  path: string;
  value: unknown;
  css: string;
  /** `$extensions["ai.objectcore.derived"].source` — the provenance marker. */
  source?: boolean | string;
}

export interface SpecRamp {
  /** The path between `color.` and the step, e.g. `"neutral"` or `"neutral.light"`. */
  family: string;
  steps: SpecRampStep[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The color ramps of a theme: `color.*` tokens whose LAST path segment is numeric,
 *  grouped by the segments in between and numeric-sorted (a ramp may carry 11 or 13
 *  steps — 150/850 half-steps sort between 100/200 and 800/900, never lexically).
 *  Family order is first appearance in the (path-sorted) token list. */
export function extractRamps(theme: DerivedTheme): SpecRamp[] {
  const groups = new Map<string, SpecRampStep[]>();
  for (const t of theme.tokens) {
    if (t.type !== "color" || !t.path.startsWith("color.")) continue;
    const segs = t.path.split(".");
    const last = segs[segs.length - 1]!;
    if (segs.length < 3 || !/^\d+$/.test(last)) continue;
    const derived = t.extensions?.[DERIVED_EXTENSION];
    const source = isObj(derived) && (typeof derived.source === "boolean" || typeof derived.source === "string")
      ? derived.source
      : undefined;
    const family = segs.slice(1, -1).join(".");
    const steps = groups.get(family) ?? [];
    if (!groups.has(family)) groups.set(family, steps);
    steps.push({ step: last, path: t.path, value: t.value, css: colorToCss(t.value), ...(source !== undefined && source !== false ? { source } : {}) });
  }
  return [...groups.entries()].map(([family, steps]) => ({
    family,
    steps: [...steps].sort((a, b) => Number(a.step) - Number(b.step)),
  }));
}

export interface SpecRole {
  path: string;
  value: unknown;
  css: string;
}

export interface SpecRoleGroup {
  /** First path segment, e.g. `"bg"`. */
  group: string;
  roles: SpecRole[];
}

/** Semantic role groups before the rest — the reading order of the contract. */
const GROUP_ORDER = ["bg", "text", "border", "accent", "status", "solid"];

/** The semantic roles of a theme: every NON-ramp color token, grouped by first path
 *  segment in canonical contract order (bg, text, border, accent, status, solid),
 *  then any remaining groups alphabetically. */
export function extractRoles(theme: DerivedTheme): SpecRoleGroup[] {
  const groups = new Map<string, SpecRole[]>();
  for (const t of theme.tokens) {
    if (t.type !== "color" || t.path.startsWith("color.")) continue;
    const group = t.path.split(".")[0]!;
    const roles = groups.get(group) ?? [];
    if (!groups.has(group)) groups.set(group, roles);
    roles.push({ path: t.path, value: t.value, css: colorToCss(t.value) });
  }
  const rank = (g: string): number => {
    const i = GROUP_ORDER.indexOf(g);
    return i === -1 ? GROUP_ORDER.length : i;
  };
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([group, roles]) => ({ group, roles }));
}

/** Per-theme provenance: which token each aliased path references, read from the
 *  MERGED (pre-resolution) tree — the reference IS the provenance. Mirrors
 *  `deriveDesignSystem`'s two branches (resolver themes vs. the single merged
 *  "default"), so it can never disagree with what the seam derived. */
export function specProvenance(source: DesignSystemSource): Record<string, Record<string, string>> {
  const collect = (merged: Record<string, unknown>): Record<string, string> => {
    const map: Record<string, string> = {};
    for (const t of flattenTokens(merged)) {
      if (isReference(t.rawValue)) map[t.path] = referencePath(t.rawValue);
    }
    return map;
  };
  const out: Record<string, Record<string, string>> = {};
  if (source.resolver && source.themes && source.themes.length > 0) {
    for (const spec of source.themes) {
      out[spec.name] = collect(applyResolver(source.sets, source.resolver, spec.context).merged);
    }
  } else {
    out["default"] = collect(Object.values(source.sets).reduce<Record<string, unknown>>((acc, t) => mergeTrees(acc, t), {}));
  }
  return out;
}

// ── HTML rendering ────────────────────────────────────────────────────────────

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Escape for a double-quoted CSS string inside a `<style>` block. `<` becomes the
 *  CSS escape `\3c ` so a hostile theme name can never form `</style>` and break
 *  out at the HTML-parser level. */
const cssStr = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/</g, "\\3c ");

/** `bg.base` → `--bg-base` (the same mapping themeDecls emits). */
const varName = (path: string): string => `--${path.replace(/\./g, "-")}`;

/** One theme with an O(1) role lookup; `css(...paths)` returns the first present
 *  role's CSS value — the wide→narrow fallback the page chrome mirrors. */
interface ThemeInfo {
  name: string;
  theme: DerivedTheme;
  vals: Map<string, unknown>;
  css: (...paths: string[]) => string | undefined;
}

function themeInfo(theme: DerivedTheme): ThemeInfo {
  const vals = new Map(theme.tokens.map((t) => [t.path, t.value]));
  const css = (...paths: string[]): string | undefined => {
    for (const p of paths) if (vals.has(p)) return colorToCss(vals.get(p));
    return undefined;
  };
  return { name: theme.name, theme, vals, css };
}

/** light/dark, read from the theme's own canvas with the gate's luminance math. */
function themeAppearance(info: ThemeInfo): "light" | "dark" | undefined {
  const canvas = info.vals.get("bg.base") ?? info.vals.get("bg.canvas");
  const lum = canvas === undefined ? null : relativeLuminance(canvas);
  return lum == null ? undefined : lum >= 0.5 ? "light" : "dark";
}

/** `:root` = the default (first) theme, plus a `[data-theme="…"]` block for EVERY
 *  theme (including the first — parity panes pin themselves with the attribute).
 *  Declarations come from the exported `themeDecls`, never a second serialization.
 *  The final `</`-guard keeps token string values from closing the `<style>` tag. */
function themeCssBlocks(output: DesignSystemOutput): string {
  const blocks: string[] = [];
  if (output.themes[0]) blocks.push(`:root {\n${themeDecls(output.themes[0])}\n}`);
  for (const theme of output.themes) {
    blocks.push(`[data-theme="${cssStr(theme.name)}"] {\n${themeDecls(theme)}\n}`);
  }
  return blocks.join("\n\n").replace(/<\//g, "<\\/");
}

/** The static page chrome. The `--s-*` aliases are (re)declared on `:root` AND every
 *  `[data-theme]` element, so the fallback chains re-resolve inside a pinned parity
 *  pane — a wide-contract system styles via `bg.base`, a narrow legacy one via
 *  `bg.canvas`, and a system with neither still renders on the literal defaults. */
function pageCss(): string {
  return `:root, [data-theme] {
  --s-bg: var(--bg-base, var(--bg-canvas, #ffffff));
  --s-surface: var(--bg-surface, var(--bg-subtle, #f3f3f1));
  --s-raised: var(--bg-raised, var(--bg-surface, #e9e9e6));
  --s-border: var(--border-subtle, #dededa);
  --s-border-strong: var(--border-strong, #b9b9b4);
  --s-text-strong: var(--text-emphasis, var(--text-primary, #101010));
  --s-text: var(--text-primary, #191919);
  --s-text-2: var(--text-secondary, var(--text-primary, #2c2c2c));
  --s-muted: var(--text-muted, var(--text-subtle, #4a4a46));
  --s-accent: var(--accent-default, var(--accent-text, var(--accent-solid, #205080)));
  --s-accent-hover: var(--accent-hover, var(--accent-solid-hover, var(--s-accent)));
  --s-accent-bg: var(--accent-subtle-bg, var(--s-raised));
  --s-on-accent: var(--accent-on-accent, var(--s-bg));
  --s-ring: var(--accent-focus-ring, var(--s-accent));
  --s-ok-bg: var(--status-success-bg, var(--s-accent-bg));
  --s-ok-text: var(--status-success-text, var(--s-text));
  --s-warn-bg: var(--status-warning-bg, var(--s-accent-bg));
  --s-warn-text: var(--status-warning-text, var(--s-text));
  --s-err-bg: var(--status-danger-bg, var(--s-accent-bg));
  --s-err-text: var(--status-danger-text, var(--s-text));
  --s-serif: var(--font-family-serif, Georgia, "Times New Roman", serif);
  --s-sans: var(--font-family-sans, system-ui, -apple-system, "Segoe UI", sans-serif);
  --s-mono: var(--font-family-mono, ui-monospace, "Cascadia Code", Consolas, monospace);
}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{background:var(--s-bg);color:var(--s-text-2);font-family:var(--s-sans);font-size:15.5px;line-height:1.65;transition:background .35s ease,color .35s ease;-webkit-font-smoothing:antialiased}
::selection{background:var(--s-accent);color:var(--s-on-accent)}
.wrap{max-width:1140px;margin:0 auto;padding:0 32px}
.bar{display:flex;justify-content:space-between;align-items:center;gap:18px;flex-wrap:wrap;padding:22px 0;border-bottom:1px solid var(--s-border)}
.bar .brand{font-family:var(--s-mono);font-size:11px;letter-spacing:.16em;color:var(--s-muted)}
.bar .brand b{color:var(--s-text-strong);font-weight:600}
.modes{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.mode{font-family:var(--s-mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--s-text);background:transparent;border:1px solid var(--s-border-strong);border-radius:999px;padding:6px 13px;cursor:pointer;transition:all .2s}
.mode:hover{border-color:var(--s-accent);color:var(--s-accent)}
.mode.active{background:var(--s-accent);color:var(--s-on-accent);border-color:var(--s-accent)}
.mode:focus-visible,.room:focus-visible,.band button:focus-visible{outline:2px solid var(--s-ring);outline-offset:2px}
.hero{padding:96px 0 72px}
.kicker{font-family:var(--s-mono);font-size:11px;letter-spacing:.18em;color:var(--s-muted);text-transform:uppercase;margin-bottom:30px}
h1{font-family:var(--s-serif);font-weight:400;color:var(--s-text-strong);font-size:clamp(56px,10vw,120px);line-height:.95;letter-spacing:-.02em;overflow-wrap:anywhere}
.stand{font-family:var(--s-serif);font-size:clamp(19px,2.2vw,25px);line-height:1.45;color:var(--s-text);max-width:820px;margin-top:36px}
.signature{display:flex;height:14px;margin-top:56px;border-radius:3px;overflow:hidden;border:1px solid var(--s-border)}
.signature span{flex:1}
section{padding:88px 0 0}
.sec-head{display:flex;align-items:baseline;gap:18px;border-top:1px solid var(--s-border);padding-top:18px;margin-bottom:8px}
.sec-num{font-family:var(--s-mono);font-size:11px;letter-spacing:.16em;color:var(--s-muted)}
h2{font-family:var(--s-serif);font-weight:400;font-size:clamp(28px,3.6vw,40px);letter-spacing:-.015em;color:var(--s-text-strong)}
.sec-note{font-size:14.5px;color:var(--s-muted);max-width:680px;margin:10px 0 40px}
.prin{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:1px;background:var(--s-border);border:1px solid var(--s-border)}
.prin div{background:var(--s-bg);padding:28px 24px 32px}
.prin h3{font-family:var(--s-serif);font-weight:400;font-size:21px;color:var(--s-text-strong);margin-bottom:12px}
.prin p{font-size:13.5px;line-height:1.6;color:var(--s-text-2)}
.ramp{margin-bottom:48px}
.ramp-head{display:flex;justify-content:space-between;align-items:baseline;gap:14px;margin-bottom:12px}
.ramp-head h3{font-family:var(--s-serif);font-style:italic;font-weight:400;font-size:22px;color:var(--s-text-strong)}
.ramp-head .meta{font-family:var(--s-mono);font-size:10.5px;letter-spacing:.08em;color:var(--s-muted);text-align:right}
.band{display:flex;border-radius:6px;overflow:hidden;border:1px solid var(--s-border)}
.band button{flex:1;height:84px;border:none;cursor:pointer;position:relative;padding:0;transition:transform .18s ease}
.band button:hover{transform:translateY(-5px)}
.band .dot{position:absolute;top:8px;left:50%;transform:translateX(-50%);width:5px;height:5px;border-radius:50%}
.band-labels{display:flex;margin-top:9px}
.band-labels div{flex:1;text-align:center;font-family:var(--s-mono);font-size:9.5px;line-height:1.5;color:var(--s-muted);overflow:hidden}
.band-labels b{display:block;font-weight:600;color:var(--s-text);font-size:10px}
.grp{margin-bottom:44px;overflow-x:auto}
.grp-name{font-family:var(--s-serif);font-style:italic;font-size:22px;color:var(--s-text-strong);margin-bottom:14px}
.role-head,.role{display:grid;gap:14px;align-items:center}
.role-head{font-family:var(--s-mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--s-muted);padding-bottom:10px;border-bottom:1px solid var(--s-border)}
.role{padding:12px 0;border-bottom:1px solid var(--s-border)}
.role .tok{font-family:var(--s-mono);font-size:12.5px;color:var(--s-text)}
.role .use{font-size:13px;color:var(--s-text-2)}
.spec{height:44px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-family:var(--s-serif);font-size:19px;border:1px solid var(--s-border)}
.spec.none{border-style:dashed;background:transparent}
.spec .chipx{font-family:var(--s-sans);font-size:11px;font-weight:600;padding:3px 12px;border-radius:999px}
.parity{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1px;background:var(--s-border);border:1px solid var(--s-border);border-radius:10px;overflow:hidden}
.pane{padding:38px 34px 42px;background:var(--s-bg);color:var(--s-text-2)}
.pane-label{font-family:var(--s-mono);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--s-muted);margin-bottom:24px}
.sheet{display:flex;flex-direction:column}
.srow{display:grid;grid-template-columns:76px 1fr;gap:18px;align-items:center;padding:16px 0;border-bottom:1px solid var(--s-border)}
.srow:last-child{border-bottom:none}
.slabel{font-family:var(--s-mono);font-size:9.5px;letter-spacing:.16em;color:var(--s-muted)}
.sline{font-size:13.5px;color:var(--s-text-2)}
.sline a{color:var(--s-accent);text-underline-offset:3px}
.sline a:hover{color:var(--s-accent-hover)}
.chip{font-size:11px;font-weight:600;padding:3px 12px;border-radius:999px}
.chip.ok{background:var(--s-ok-bg);color:var(--s-ok-text)}
.chip.warn{background:var(--s-warn-bg);color:var(--s-warn-text)}
.chip.err{background:var(--s-err-bg);color:var(--s-err-text)}
.btn{font-family:var(--s-sans);font-size:13px;font-weight:600;border:none;border-radius:6px;padding:9px 18px;cursor:pointer;background:var(--s-accent);color:var(--s-on-accent);margin-right:10px}
.btn:hover{background:var(--s-accent-hover)}
.btn.quiet{background:transparent;color:var(--s-accent);border:1px solid var(--s-border-strong)}
.btn.ring{outline:2px solid var(--s-ring);outline-offset:2px}
.sel{display:flex;justify-content:space-between;align-items:center;background:var(--s-accent-bg);color:var(--s-text);border-left:2px solid var(--s-accent);border-radius:6px;padding:11px 16px;font-size:13.5px;font-weight:550;max-width:420px}
.sel .mono-meta{font-family:var(--s-mono);font-size:10px;letter-spacing:.08em;color:var(--s-muted)}
.rooms{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px}
.room{display:flex;flex-direction:column;text-align:left;cursor:pointer;padding:0;border:1px solid var(--s-border);border-radius:10px;overflow:hidden;background:var(--s-surface);transition:transform .18s ease,border-color .18s;font-family:inherit}
.room:hover{transform:translateY(-4px);border-color:var(--s-accent)}
.room.active{border-color:var(--s-accent)}
.room .strip{display:flex;height:56px}
.room .strip span{flex:1}
.room .vstrip{display:flex;height:6px}
.room .vstrip span{flex:1}
.room .body{display:block;padding:13px 15px 15px}
.room .rname{display:block;font-family:var(--s-serif);font-style:italic;font-size:18px;color:var(--s-text-strong);margin-bottom:6px}
.room .rmeta{display:block;font-family:var(--s-mono);font-size:9px;letter-spacing:.1em;color:var(--s-muted)}
.proof{width:100%;border-collapse:collapse;font-family:var(--s-mono)}
.proof th{text-align:left;font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:500;color:var(--s-muted);padding:10px 12px;border-bottom:1px solid var(--s-border-strong)}
.proof th.r,.proof td.r{text-align:right}
.proof td{font-size:12px;padding:9px 12px;border-bottom:1px solid var(--s-border);color:var(--s-text-2)}
.proof td.r{color:var(--s-text)}
.pair{display:inline-flex;width:26px;height:15px;border-radius:4px;vertical-align:-3px;margin-right:9px;border:1px solid var(--s-border);align-items:center;justify-content:center;font-size:9px;font-weight:700;line-height:1}
.badge{display:inline-block;font-size:10px;font-weight:600;letter-spacing:.08em;padding:2px 10px;border-radius:999px}
.badge.pass{background:var(--s-ok-bg);color:var(--s-ok-text)}
.badge.fail{background:var(--s-err-bg);color:var(--s-err-text)}
.badge.exempt{background:var(--s-raised);color:var(--s-muted)}
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:32px;margin-bottom:40px}
.steps h3{font-family:var(--s-serif);font-weight:400;font-size:20px;color:var(--s-text-strong);margin-bottom:10px}
.steps .n{font-family:var(--s-mono);font-size:10.5px;letter-spacing:.14em;color:var(--s-accent);display:block;margin-bottom:12px}
.steps p{font-size:13.5px;color:var(--s-text-2)}
.steps code{font-family:var(--s-mono);font-size:12px;color:var(--s-text)}
pre{background:var(--s-raised);border:1px solid var(--s-border);border-radius:10px;padding:22px 26px;font-family:var(--s-mono);font-size:12.5px;line-height:1.8;color:var(--s-text);overflow-x:auto}
pre .c{color:var(--s-muted)}
pre .a{color:var(--s-accent)}
.colophon{margin-top:100px;border-top:1px solid var(--s-border);padding:30px 0 70px;display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap}
.colophon p{font-family:var(--s-mono);font-size:10.5px;letter-spacing:.06em;line-height:2;color:var(--s-muted)}
.colophon b{color:var(--s-text);font-weight:500}
.toast{position:fixed;bottom:28px;left:50%;transform:translateX(-50%) translateY(8px);background:var(--s-text-strong);color:var(--s-bg);font-family:var(--s-mono);font-size:11.5px;letter-spacing:.06em;padding:9px 20px;border-radius:999px;opacity:0;transition:.22s ease;pointer-events:none}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}`;
}

const secHead = (num: string, title: string, note: string): string =>
  `<div class="sec-head"><span class="sec-num">${num}</span><h2>${esc(title)}</h2></div>
  <p class="sec-note">${esc(note)}</p>`;

function topBar(system: string, infos: ThemeInfo[]): string {
  const buttons = infos
    .map((t) => `<button class="mode" type="button" data-set-theme="${esc(t.name)}">${esc(t.name.toUpperCase())}</button>`)
    .join("");
  return `<div class="bar">
    <span class="brand"><b>${esc(system.toUpperCase())}</b> · DESIGN SYSTEM SPEC</span>
    <div class="modes" role="group" aria-label="Theme">${buttons}</div>
  </div>`;
}

function hero(title: string, kicker: string, tagline: string | undefined, signature: SpecRampStep[]): string {
  const sig = signature.length
    ? `\n    <div class="signature" aria-hidden="true">${signature.map((s) => `<span style="background:${esc(s.css)}"></span>`).join("")}</div>`
    : "";
  return `<header class="hero">
    <p class="kicker">${esc(kicker)}</p>
    <h1>${esc(title)}</h1>${tagline ? `\n    <p class="stand">${esc(tagline)}</p>` : ""}${sig}
  </header>`;
}

function principlesSection(num: string, principles: Array<{ title: string; body: string }>): string {
  const cards = principles.map((p) => `<div><h3>${esc(p.title)}</h3><p>${esc(p.body)}</p></div>`).join("\n      ");
  return `<section id="principles">
  ${secHead(num, "Principles.", "The rules that carry the system. Everything below is arithmetic.")}
  <div class="prin">
      ${cards}
  </div>
</section>`;
}

function rampsSection(num: string, ramps: SpecRamp[], notes?: Record<string, string>): string {
  const blocks = ramps
    .map((ramp) => {
      const note = notes?.[ramp.family];
      const meta = `${ramp.steps.length} steps${note ? ` · ${note}` : ""}`;
      const band = ramp.steps
        .map((s) => {
          const lum = relativeLuminance(s.value);
          const dot = s.source
            ? `<span class="dot" style="background:${lum != null && lum > 0.35 ? "rgba(10,10,10,.55)" : "rgba(250,250,250,.6)"}" title="${esc(typeof s.source === "string" ? s.source : "recorded at the source")}"></span>`
            : "";
          return `<button type="button" style="background:${esc(s.css)}" data-copy="${esc(s.css)}" title="${esc(`${ramp.family}-${s.step} · ${s.css}`)}" aria-label="${esc(`Copy ${s.css}`)}">${dot}</button>`;
        })
        .join("");
      const labels = ramp.steps
        .map((s) => `<div><b>${esc(s.step)}</b>${s.css.startsWith("#") ? esc(s.css.slice(1)) : ""}</div>`)
        .join("");
      return `<div class="ramp" data-ramp="${esc(ramp.family)}">
    <div class="ramp-head"><h3>${esc(ramp.family)}</h3><span class="meta">${esc(meta)}</span></div>
    <div class="band">${band}</div>
    <div class="band-labels">${labels}</div>
  </div>`;
    })
    .join("\n  ");
  return `<section id="ramps">
  ${secHead(num, "The material.", "Click any step to copy its value. A dot marks a value recorded at the source; every step is the resolved value the themes actually reference.")}
  ${blocks}
</section>`;
}

/** How a role is SHOWN (never how it is gated — that is roles.ts): as a fill, a
 *  boundary line, text on the accent/solid it labels, a status chip, or plain text. */
function roleKind(path: string): "fill" | "line" | "on" | "chip" | "text" {
  if (path.startsWith("border.") || path === "accent.focus-ring") return "line";
  if (path === "accent.on-accent" || path.startsWith("solid.on-")) return "on";
  if (path.startsWith("status.") && path.endsWith("-text")) return "chip";
  if (path.startsWith("bg.") || path.startsWith("solid.") || path.endsWith("-bg")) return "fill";
  return "text";
}

function roleCell(info: ThemeInfo, path: string, prov?: Record<string, Record<string, string>>): string {
  const v = info.vals.get(path);
  if (v === undefined) return `<div class="spec none" title="${esc(`${path} — not defined in ${info.name}`)}"></div>`;
  const css = colorToCss(v);
  const ref = prov?.[info.name]?.[path];
  const title = esc(ref ? `${path} = {${ref}} · ${css}` : `${path} · ${css}`);
  const canvas = info.css("bg.base", "bg.canvas") ?? "#ffffff";
  switch (roleKind(path)) {
    case "fill":
      return `<div class="spec" style="background:${esc(css)}" title="${title}"></div>`;
    case "line":
      return `<div class="spec" style="background:${esc(canvas)};border:2px solid ${esc(css)}" title="${title}"></div>`;
    case "on": {
      const backdrop = path.startsWith("solid.on-")
        ? info.css(`solid.${path.slice("solid.on-".length)}`)
        : info.css("accent.default", "accent.solid");
      return `<div class="spec" style="background:${esc(backdrop ?? canvas)};color:${esc(css)}" title="${title}">Aa</div>`;
    }
    case "chip": {
      const chipBg = info.css(path.replace(/-text$/, "-bg"));
      return `<div class="spec" style="background:${esc(canvas)}" title="${title}"><span class="chipx" style="background:${esc(chipBg ?? canvas)};color:${esc(css)}">Aa</span></div>`;
    }
    default:
      return `<div class="spec" style="background:${esc(canvas)};color:${esc(css)}" title="${title}">Aa</div>`;
  }
}

function rolesSection(
  num: string,
  groups: SpecRoleGroup[],
  infos: ThemeInfo[],
  prov?: Record<string, Record<string, string>>,
  notes?: Record<string, string>,
): string {
  const hasNotes = notes !== undefined && Object.keys(notes).length > 0;
  const cols = `minmax(140px,200px) repeat(${infos.length},minmax(88px,1fr))${hasNotes ? " minmax(160px,1.4fr)" : ""}`;
  const head = `<div class="role-head" style="grid-template-columns:${cols}"><span>Role</span>${infos
    .map((t) => `<span>${esc(t.name)}</span>`)
    .join("")}${hasNotes ? "<span>Use</span>" : ""}</div>`;
  const blocks = groups
    .map((g) => {
      const rows = g.roles
        .map((role) => {
          const cells = infos.map((info) => roleCell(info, role.path, prov)).join("");
          const note = hasNotes ? `<span class="use">${esc(notes?.[role.path] ?? "")}</span>` : "";
          return `<div class="role" style="grid-template-columns:${cols}"><span class="tok">${esc(varName(role.path))}</span>${cells}${note}</div>`;
        })
        .join("\n    ");
      return `<div class="grp" data-role-group="${esc(g.group)}">
    <div class="grp-name">${esc(g.group)}</div>
    ${head}
    ${rows}
  </div>`;
    })
    .join("\n  ");
  return `<section id="roles">
  ${secHead(num, "Components speak in roles.", "Never in raw values. Each role resolves per theme; hover a swatch for the value and the primitive it references.")}
  ${blocks}
</section>`;
}

/** The specimen sheet — action, link, verdict, selection, focus — styled entirely by
 *  the `--s-*` chrome, so a pane pinned to a theme wears that theme's roles. */
function specimenSheet(): string {
  return `<div class="sheet">
        <div class="srow"><span class="slabel">ACTION</span><div><button class="btn" type="button">Run agent</button><button class="btn quiet" type="button">Configure</button></div></div>
        <div class="srow"><span class="slabel">LINK</span><p class="sline">Every claim cites <a href="#proof">its sources</a>.</p></div>
        <div class="srow"><span class="slabel">VERDICT</span><div><span class="chip ok">Succeeded</span> <span class="chip warn">Needs review</span> <span class="chip err">Failed</span></div></div>
        <div class="srow"><span class="slabel">SELECTED</span><div class="sel">Migration agent<span class="mono-meta">RUN 0142</span></div></div>
        <div class="srow"><span class="slabel">FOCUS</span><div><button class="btn quiet ring" type="button">Approve plan</button></div></div>
      </div>`;
}

function paritySection(num: string, infos: ThemeInfo[]): string {
  const panes = infos
    .slice(0, 2)
    .map((info) => {
      const app = themeAppearance(info);
      return `<div class="pane" data-theme="${esc(info.name)}">
      <p class="pane-label">${esc(`${info.name.toUpperCase()}${app ? ` — ${app}` : ""}`)}</p>
      ${specimenSheet()}
    </div>`;
    })
    .join("\n    ");
  return `<section id="parity">
  ${secHead(num, "Every theme, same sentence.", "The same specimen sheet, pinned to a theme per pane — action, link, verdict, selection, focus. No overrides; parity is structural, not curated.")}
  <div class="parity">
    ${panes}
  </div>
</section>`;
}

function roomsGallery(num: string, infos: ThemeInfo[], proof?: ProofEntry[]): string {
  const rooms = infos
    .map((info) => {
      const strip = [
        info.css("bg.base", "bg.canvas"),
        info.css("bg.surface", "bg.subtle"),
        info.css("bg.raised", "bg.surface"),
        info.css("accent.subtle-bg", "bg.surface"),
        info.css("accent.default", "accent.solid", "accent.text"),
      ].filter((c): c is string => c !== undefined);
      const verd = ["success", "warning", "danger"]
        .map((s) => info.css(`status.${s}-text`, `solid.${s}`))
        .filter((c): c is string => c !== undefined);
      const gated = proof?.filter((e) => e.theme === info.name && !e.exempt) ?? [];
      const app = themeAppearance(info);
      const meta = [
        app?.toUpperCase(),
        gated.length ? `${gated.filter((e) => e.pass).length}/${gated.length} pairs pass` : `${info.theme.tokens.length} tokens`,
      ]
        .filter(Boolean)
        .join(" · ");
      return `<button class="room" type="button" data-set-theme="${esc(info.name)}">
      <span class="strip">${strip.map((c) => `<span style="background:${esc(c)}"></span>`).join("")}</span>
      <span class="vstrip">${verd.map((c) => `<span style="background:${esc(c)}"></span>`).join("")}</span>
      <span class="body"><i class="rname">${esc(info.name)}</i><span class="rmeta">${esc(meta)}</span></span>
    </button>`;
    })
    .join("\n    ");
  return `<section id="rooms">
  ${secHead(num, `One system, ${infos.length} room${infos.length === 1 ? "" : "s"}.`, "Same primitives, same roles, same gate — different light. Click a room and the whole document wears it.")}
  <div class="rooms">
    ${rooms}
  </div>
</section>`;
}

function proofSection(num: string, proof: ProofEntry[]): string {
  const levels = [...new Set(proof.filter((e) => !e.exempt && e.kind === "text").map((e) => e.level))].sort().join(" / ");
  const rows = proof
    .map((e) => {
      const ratio = e.ratio == null ? "—" : `${e.ratio.toFixed(2)}:1`;
      const [cls, grade] = e.exempt
        ? ["exempt", "EXEMPT"]
        : !e.pass
          ? ["fail", "FAIL"]
          : ["pass", e.kind === "non-text" ? "PASS" : e.level];
      return `<tr><td>${esc(e.theme)}</td><td><span class="pair" style="background:${esc(colorToCss(e.bg))};color:${esc(colorToCss(e.fg))}">Aa</span>${esc(e.label)}</td><td class="r">${ratio}</td><td class="r">≥ ${e.required}:1</td><td><span class="badge ${cls}">${grade}</span></td></tr>`;
    })
    .join("\n      ");
  const note = `Every documented pairing, measured against WCAG 2.1 relative luminance — the same math the gate runs${levels ? `; text pairs gate at ${levels}` : ""}, non-text boundaries at the 3:1 floor (SC 1.4.11). EXEMPT rows are documented by design and never gated. Failures are shown, not hidden.`;
  return `<section id="proof">
  ${secHead(num, "Measured, not promised.", note)}
  <table class="proof">
    <thead><tr><th>Theme</th><th>Pairing</th><th class="r">Ratio</th><th class="r">Floor</th><th>Grade</th></tr></thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</section>`;
}

function adoptionSection(num: string, input: SpecInput, infos: ThemeInfo[], groups: SpecRoleGroup[]): string {
  const fileName = input.copy?.adoptionFileName ?? "tokens.css";
  const first = infos[0];
  const has = (path: string): boolean => first?.vals.has(path) ?? false;
  const bgRole = has("bg.base") ? "bg.base" : has("bg.canvas") ? "bg.canvas" : (groups[0]?.roles[0]?.path ?? "bg.base");
  const accentRole = has("accent.default") ? "accent.default" : has("accent.solid") ? "accent.solid" : has("accent.text") ? "accent.text" : bgRole;
  const onRole = has("accent.on-accent") ? "accent.on-accent" : bgRole;
  const alt = infos[1]?.name ?? infos[0]?.name ?? "default";
  const themeList = infos.map((t) => t.name).join(" · ");
  return `<section id="adoption">
  ${secHead(num, "Three steps to ship.", "The whole system is one stylesheet. Everything downstream is a role.")}
  <div class="steps">
    <div><span class="n">STEP 01</span><h3>Link the tokens.</h3><p>One file, no build step. <code>${esc(fileName)}</code> carries every theme and the measured semantic layer.</p></div>
    <div><span class="n">STEP 02</span><h3>Speak in roles.</h3><p>Product code references <code>${esc(`var(${varName(accentRole)})`)}</code> and <code>${esc(`var(${varName(bgRole)})`)}</code> — never a raw value. When the palette evolves, nothing downstream moves.</p></div>
    <div><span class="n">STEP 03</span><h3>Flip one attribute.</h3><p><code>${esc(`data-theme="${alt}"`)}</code> on the root remaps every role. Themes: ${esc(themeList)}.</p></div>
  </div>
  <pre><span class="c">&lt;!-- the entire adoption surface --&gt;</span>
&lt;link rel="stylesheet" href="<span class="a">${esc(fileName)}</span>"&gt;

&lt;html data-theme="<span class="a">${esc(alt)}</span>"&gt;

.action {
  background: <span class="a">var(${esc(varName(accentRole))})</span>;
  color: <span class="a">var(${esc(varName(onRole))})</span>;
}</pre>
</section>`;
}

function colophon(input: SpecInput, infos: ThemeInfo[]): string {
  const tokens = infos[0]?.theme.tokens.length ?? 0;
  const fileName = input.copy?.adoptionFileName ?? "tokens.css";
  const voice = input.brief?.adjectives?.length
    ? `\n    <p><b>Voice.</b> ${esc(input.brief.adjectives.join(" · "))}</p>`
    : "";
  return `<div class="colophon">
    <p><b>${esc(input.system)}.</b> ${infos.length} theme${infos.length === 1 ? "" : "s"} · ${tokens} tokens per theme<br>measured in WCAG 2.1 — the proof table is the gate&#39;s own math</p>
    <p><b>Files.</b> ${esc(fileName)} · &lt;theme&gt;.tokens.json · theme.css<br>&lt;theme&gt;.sd.json · contrast-proof.json · this page</p>${voice}
    <p><b>Generated.</b> @objectcore/design SpecHtmlSink<br>a build artifact — regenerate with bun run design:build, never hand-edit</p>
  </div>`;
}

/** The machine-readable data island + the interaction wiring (theme switching via
 *  `dataset.theme`, click-to-copy via the Clipboard API). `<` is escaped in the JSON
 *  so embedded data can never close the script element. */
function pageScript(spec: unknown): string {
  const json = JSON.stringify(spec).replace(/</g, "\\u003c");
  return `<script>
const SPEC = ${json};
(function () {
  const root = document.documentElement;
  const switches = Array.from(document.querySelectorAll("[data-set-theme]"));
  function setTheme(name) {
    root.dataset.theme = name;
    for (const el of switches) el.classList.toggle("active", el.getAttribute("data-set-theme") === name);
  }
  for (const el of switches) el.addEventListener("click", function () { setTheme(el.getAttribute("data-set-theme")); });
  const toast = document.getElementById("toast");
  let timer;
  for (const el of document.querySelectorAll("[data-copy]")) {
    el.addEventListener("click", function () {
      const value = el.getAttribute("data-copy");
      if (navigator.clipboard) navigator.clipboard.writeText(value);
      toast.textContent = value + " → copied";
      toast.classList.add("show");
      clearTimeout(timer);
      timer = setTimeout(function () { toast.classList.remove("show"); }, 1300);
    });
  }
  setTheme(SPEC.themes[0]);
})();
</script>`;
}

/** Render the whole spec page. Pure and deterministic — same input, same bytes. */
export function renderSpecHtml(input: SpecInput): string {
  const infos = input.output.themes.map(themeInfo);
  const first = infos[0];
  const ramps = first ? extractRamps(first.theme) : [];
  const groups = first ? extractRoles(first.theme) : [];
  const proof = input.proof;

  const title = input.copy?.title ?? input.system;
  const tagline = input.copy?.tagline ?? input.brief?.intent;
  const gated = proof?.filter((e) => !e.exempt) ?? [];
  const kickerParts = [
    ...(ramps.length ? [`${ramps.reduce((n, r) => n + r.steps.length, 0)} color values`] : []),
    `${infos.length} theme${infos.length === 1 ? "" : "s"}`,
    ...(gated.length ? [`${gated.filter((e) => e.pass).length}/${gated.length} measured pairs pass`] : []),
  ];
  const kicker = input.copy?.kicker ?? kickerParts.join(" · ");

  let n = 0;
  const num = (): string => String(++n).padStart(2, "0");
  const sections: string[] = [];
  if (input.copy?.principles?.length) sections.push(principlesSection(num(), input.copy.principles));
  if (ramps.length) sections.push(rampsSection(num(), ramps, input.copy?.rampNotes));
  if (groups.length) sections.push(rolesSection(num(), groups, infos, input.provenance, input.copy?.roleNotes));
  if (infos.length) sections.push(paritySection(num(), infos));
  if (infos.length) sections.push(roomsGallery(num(), infos, proof));
  if (proof?.length) sections.push(proofSection(num(), proof));
  sections.push(adoptionSection(num(), input, infos, groups));

  const spec = {
    system: input.system,
    themes: infos.map((t) => t.name),
    ramps: ramps.map((r) => ({ family: r.family, steps: r.steps.length })),
    roles: groups.map((g) => ({ group: g.group, roles: g.roles.length })),
    proof: proof
      ? {
          entries: proof.length,
          pass: proof.filter((e) => e.pass && !e.exempt).length,
          fail: proof.filter((e) => !e.pass && !e.exempt).length,
          exempt: proof.filter((e) => e.exempt).length,
        }
      : null,
  };

  return `<!DOCTYPE html>
<!-- Generated by @objectcore/design (SpecHtmlSink) — a build artifact, never hand-edited. -->
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — a design system, measured</title>
<style>
${themeCssBlocks(input.output)}

${pageCss()}
</style>
</head>
<body>
<div class="wrap">
  ${topBar(input.system, infos)}
  ${hero(title, kicker, tagline, ramps[0]?.steps ?? [])}
  ${sections.join("\n\n  ")}
  ${colophon(input, infos)}
</div>
<div class="toast" id="toast" role="status" aria-live="polite">copied</div>
${pageScript(spec)}
</body>
</html>
`;
}

/** Everything the spec page needs beyond the derived output itself. */
export interface SpecMeta {
  system: string;
  proof?: ProofEntry[];
  provenance?: Record<string, Record<string, string>>;
  copy?: SpecCopy;
  brief?: DesignBrief;
}

/** Emits `spec.html` — the generated specimen page. The proof entries are injected
 *  (computed once by the caller from the same gate math), never recomputed here. */
export class SpecHtmlSink implements TokenSink {
  constructor(
    private readonly meta: SpecMeta,
    private readonly fileName = "spec.html",
  ) {}

  emit(output: DesignSystemOutput): SinkFile[] {
    return [{ path: this.fileName, content: renderSpecHtml({ ...this.meta, output }) }];
  }
}
