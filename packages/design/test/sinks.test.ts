import { test, expect } from "bun:test";
import { CssVarSink, JsonSink, TailwindThemeSink, StyleDictionarySink } from "../src/sinks";
import type { DesignSystemOutput } from "../src/derive";

const output: DesignSystemOutput = {
  issues: [],
  themes: [
    {
      name: "light",
      context: { theme: "light" },
      tokens: [
        { path: "color.bg", type: "color", value: { colorSpace: "oklch", components: [0.99, 0, 0] } },
        { path: "space.md", type: "dimension", value: { value: 16, unit: "px" } },
        { path: "motion.fast", type: "duration", value: { value: 150, unit: "ms" } },
        { path: "ease.standard", type: "cubicBezier", value: [0.2, 0, 0, 1] },
      ],
    },
    {
      name: "dark",
      context: { theme: "dark" },
      tokens: [{ path: "color.bg", type: "color", value: { colorSpace: "oklch", components: [0.2, 0, 0] } }],
    },
  ],
};

test("CssVarSink emits :root for the first theme and [data-theme] for the rest", () => {
  const [file] = new CssVarSink().emit(output);
  expect(file!.path).toBe("tokens.css");
  expect(file!.content).toContain(":root {");
  expect(file!.content).toContain('[data-theme="dark"] {');
});

test("CssVarSink serializes values per type (oklch, px, ms, cubic-bezier) under kebab var names", () => {
  const css = new CssVarSink().emit(output)[0]!.content;
  expect(css).toContain("--color-bg: oklch(0.99 0 0);");
  expect(css).toContain("--space-md: 16px;");
  expect(css).toContain("--motion-fast: 150ms;");
  expect(css).toContain("--ease-standard: cubic-bezier(0.2, 0, 0, 1);");
});

test("CssVarSink expands a typography composite into sub-vars", () => {
  const typo: DesignSystemOutput = {
    issues: [],
    themes: [
      {
        name: "default",
        context: {},
        tokens: [
          {
            path: "text.h1",
            type: "typography",
            value: { fontFamily: ["Helvetica Neue", "sans-serif"], fontSize: { value: 32, unit: "px" }, fontWeight: 700, letterSpacing: { value: 0, unit: "px" }, lineHeight: 1.2 },
          },
        ],
      },
    ],
  };
  const css = new CssVarSink().emit(typo)[0]!.content;
  // multi-word families are quoted; CSS keywords like sans-serif are not
  expect(css).toContain('--text-h1-font-family: "Helvetica Neue", sans-serif;');
  expect(css).toContain("--text-h1-font-size: 32px;");
  expect(css).toContain("--text-h1-line-height: 1.2;");
});

test("CssVarSink maps an object strokeStyle to the nearest CSS keyword — never an empty declaration or [object Object]", () => {
  const strokes: DesignSystemOutput = {
    issues: [],
    themes: [
      {
        name: "default",
        context: {},
        tokens: [
          {
            path: "border.style.focus",
            type: "strokeStyle",
            value: { dashArray: [{ value: 4, unit: "px" }, { value: 2, unit: "px" }], lineCap: "round" },
          },
          { path: "border.style.plain", type: "strokeStyle", value: "solid" },
          {
            path: "border.focus",
            type: "border",
            value: {
              width: { value: 1, unit: "px" },
              style: { dashArray: [{ value: 4, unit: "px" }], lineCap: "butt" },
              color: "#0000ff",
            },
          },
        ],
      },
    ],
  };
  const css = new CssVarSink().emit(strokes)[0]!.content;
  expect(css).toContain("--border-style-focus: dashed;"); // object form → keyword
  expect(css).toContain("--border-style-plain: solid;"); // string form passes through
  expect(css).toContain("--border-focus: 1px dashed #0000ff;"); // inside the border shorthand too
  expect(css).not.toContain("[object Object]");
  expect(css).not.toContain(": ;");
});

test("JsonSink emits one path→value file per theme", () => {
  const files = new JsonSink().emit(output);
  expect(files.map((f) => f.path)).toEqual(["light.tokens.json", "dark.tokens.json"]);
  expect(JSON.parse(files[0]!.content)["space.md"]).toEqual({ value: 16, unit: "px" });
});

// ── TailwindThemeSink ─────────────────────────────────────────────────────────

/** A two-theme system: primitives shared (invariant), the semantic `bg.canvas`
 *  color differs light↔dark (themeable). */
const tw: DesignSystemOutput = {
  issues: [],
  themes: [
    {
      name: "light",
      context: { theme: "light" },
      tokens: [
        { path: "color.accent.light.9", type: "color", value: { colorSpace: "oklch", components: [0.62, 0.15, 264] } },
        { path: "space.4", type: "dimension", value: { value: 16, unit: "px" } },
        { path: "radius.lg", type: "dimension", value: { value: 16, unit: "px" } },
        { path: "font.size.base", type: "dimension", value: { value: 1, unit: "rem" } },
        { path: "font.family.sans", type: "fontFamily", value: ["Inter", "system-ui", "sans-serif"] },
        { path: "font.weight.bold", type: "fontWeight", value: 700 },
        { path: "motion.easing.standard", type: "cubicBezier", value: [0.2, 0, 0, 1] },
        { path: "motion.duration.fast", type: "duration", value: { value: 150, unit: "ms" } },
        { path: "bg.canvas", type: "color", value: { colorSpace: "oklch", components: [0.99, 0, 0] } },
      ],
    },
    {
      name: "dark",
      context: { theme: "dark" },
      tokens: [
        { path: "color.accent.light.9", type: "color", value: { colorSpace: "oklch", components: [0.62, 0.15, 264] } },
        { path: "space.4", type: "dimension", value: { value: 16, unit: "px" } },
        { path: "radius.lg", type: "dimension", value: { value: 16, unit: "px" } },
        { path: "font.size.base", type: "dimension", value: { value: 1, unit: "rem" } },
        { path: "font.family.sans", type: "fontFamily", value: ["Inter", "system-ui", "sans-serif"] },
        { path: "font.weight.bold", type: "fontWeight", value: 700 },
        { path: "motion.easing.standard", type: "cubicBezier", value: [0.2, 0, 0, 1] },
        { path: "motion.duration.fast", type: "duration", value: { value: 150, unit: "ms" } },
        { path: "bg.canvas", type: "color", value: { colorSpace: "oklch", components: [0.17, 0, 0] } },
      ],
    },
  ],
};

test("TailwindThemeSink maps each token type to its Tailwind @theme namespace", () => {
  const css = new TailwindThemeSink().emit(tw)[0]!.content;
  expect(css).toContain("@theme {");
  expect(css).toContain("--color-accent-light-9: oklch(0.62 0.15 264);"); // primitive color
  expect(css).toContain("--spacing-4: 16px;"); // space.* → spacing
  expect(css).toContain("--radius-lg: 16px;"); // radius.* → radius
  expect(css).toContain("--text-base: 1rem;"); // font.size.* → text (font-size)
  expect(css).toContain("--font-sans: Inter, system-ui, sans-serif;"); // fontFamily → font
  expect(css).toContain("--font-weight-bold: 700;"); // fontWeight → font-weight
  expect(css).toContain("--ease-standard: cubic-bezier(0.2, 0, 0, 1);"); // cubicBezier → ease
});

test("TailwindThemeSink emits a default filename of theme.css, one file", () => {
  const files = new TailwindThemeSink().emit(tw);
  expect(files).toHaveLength(1);
  expect(files[0]!.path).toBe("theme.css");
});

test("TailwindThemeSink routes themeable colors through @theme inline + data-theme overrides", () => {
  const css = new TailwindThemeSink().emit(tw)[0]!.content;
  // The namespaced utility var points at a mode-switched custom property...
  expect(css).toContain("@theme inline {");
  expect(css).toContain("--color-bg-canvas: var(--bg-canvas);");
  // ...whose value is set per theme (:root for the first, [data-theme] for the rest).
  expect(css).toContain(":root {");
  expect(css).toContain("--bg-canvas: oklch(0.99 0 0);");
  expect(css).toContain('[data-theme="dark"] {');
  expect(css).toContain("--bg-canvas: oklch(0.17 0 0);");
  // A themeable color is NOT frozen into @theme as a fixed value.
  expect(css).not.toContain("--color-bg-canvas: oklch");
});

test("TailwindThemeSink keeps invariant primitives out of the themed selectors", () => {
  const css = new TailwindThemeSink().emit(tw)[0]!.content;
  const root = css.slice(css.indexOf(":root {"));
  expect(root).not.toContain("--color-accent-light-9"); // invariant → @theme only
});

test("TailwindThemeSink falls back to a plain custom property for types with no namespace", () => {
  const css = new TailwindThemeSink().emit(tw)[0]!.content;
  // duration has no Tailwind theme namespace → emitted as a usable raw var in @theme.
  expect(css).toContain("--motion-duration-fast: 150ms;");
});

test("TailwindThemeSink emits a single @theme block (no inline/selectors) for a one-theme system", () => {
  const single: DesignSystemOutput = {
    issues: [],
    themes: [
      {
        name: "default",
        context: {},
        tokens: [{ path: "bg.canvas", type: "color", value: { colorSpace: "oklch", components: [0.99, 0, 0] } }],
      },
    ],
  };
  const css = new TailwindThemeSink().emit(single)[0]!.content;
  expect(css).toContain("--color-bg-canvas: oklch(0.99 0 0);");
  expect(css).not.toContain("@theme inline");
  expect(css).not.toContain("data-theme");
});

// ── StyleDictionarySink ───────────────────────────────────────────────────────

test("StyleDictionarySink emits one <theme>.sd.json per theme of valid JSON", () => {
  const files = new StyleDictionarySink().emit(tw);
  expect(files.map((f) => f.path)).toEqual(["light.sd.json", "dark.sd.json"]);
  expect(() => JSON.parse(files[0]!.content)).not.toThrow();
});

test("StyleDictionarySink rebuilds a nested tree with {value,type} leaves per token type", () => {
  const light = JSON.parse(new StyleDictionarySink().emit(tw)[0]!.content);
  expect(light.color.accent.light["9"]).toEqual({ value: "oklch(0.62 0.15 264)", type: "color" });
  expect(light.space["4"]).toEqual({ value: "16px", type: "dimension" });
  expect(light.radius.lg).toEqual({ value: "16px", type: "dimension" });
  expect(light.font.size.base).toEqual({ value: "1rem", type: "dimension" });
  expect(light.font.family.sans).toEqual({ value: "Inter, system-ui, sans-serif", type: "fontFamily" });
  expect(light.font.weight.bold).toEqual({ value: "700", type: "fontWeight" });
  expect(light.motion.easing.standard).toEqual({ value: "cubic-bezier(0.2, 0, 0, 1)", type: "cubicBezier" });
  expect(light.motion.duration.fast).toEqual({ value: "150ms", type: "duration" });
});

test("StyleDictionarySink carries each theme's resolved values (light vs dark)", () => {
  const [light, dark] = new StyleDictionarySink().emit(tw).map((f) => JSON.parse(f.content));
  expect(light.bg.canvas.value).toBe("oklch(0.99 0 0)");
  expect(dark.bg.canvas.value).toBe("oklch(0.17 0 0)");
});

test("StyleDictionarySink expands a typography composite into SD sub-token leaves", () => {
  const typo: DesignSystemOutput = {
    issues: [],
    themes: [
      {
        name: "default",
        context: {},
        tokens: [
          {
            path: "text.h1",
            type: "typography",
            value: { fontFamily: ["Helvetica Neue", "sans-serif"], fontSize: { value: 32, unit: "px" }, fontWeight: 700, letterSpacing: { value: 0, unit: "px" }, lineHeight: 1.2 },
          },
        ],
      },
    ],
  };
  const tree = JSON.parse(new StyleDictionarySink().emit(typo)[0]!.content);
  expect(tree.text.h1["font-family"]).toEqual({ value: '"Helvetica Neue", sans-serif', type: "fontFamily" });
  expect(tree.text.h1["font-size"]).toEqual({ value: "32px", type: "dimension" });
  expect(tree.text.h1["line-height"]).toEqual({ value: "1.2", type: "number" });
});
