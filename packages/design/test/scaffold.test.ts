import { test, expect } from "bun:test";
import { scaffoldDesignSystem, type ScaffoldSpec } from "../src/scaffold";
import { validateTokens } from "../src/schema";
import { deriveDesignSystem } from "../src/derive";
import { checkContrast } from "../src/gate";
import { contrastRatio } from "../src/color";

const spec: ScaffoldSpec = {
  brief: { name: "objectcore", adjectives: ["modern", "trustworthy"] },
  colors: [{ name: "accent", hue: 250 }],
  baseUnit: 4,
  baseFontPx: 16,
  typeRatio: 1.25,
};

test("scaffold self-gates clean (valid + accessible by construction)", () => {
  const { issues } = scaffoldDesignSystem(spec);
  expect(issues.filter((i) => i.level === "error")).toEqual([]);
});

test("scaffold emits primitives + light/dark semantic sets and a resolver", () => {
  const { source } = scaffoldDesignSystem(spec);
  expect(Object.keys(source.sets).sort()).toEqual(["primitives", "semantic-dark", "semantic-light"]);
  expect(source.resolver?.modifiers[0]!.name).toBe("theme");
  expect(source.themes?.map((t) => t.name)).toEqual(["light", "dark"]);
});

test("every emitted set is structurally valid DTCG", () => {
  const { source } = scaffoldDesignSystem(spec);
  for (const set of Object.values(source.sets)) {
    expect(validateTokens(set).filter((i) => i.level === "error")).toEqual([]);
  }
});

test("a neutral family is auto-generated when not supplied", () => {
  const { source } = scaffoldDesignSystem(spec);
  const color = (source.sets.primitives as { color: Record<string, unknown> }).color;
  expect(color.neutral).toBeDefined();
  expect(color.accent).toBeDefined();
});

test("derived text/background pairs actually meet WCAG by construction, in BOTH themes", () => {
  const { source } = scaffoldDesignSystem(spec);
  const out = deriveDesignSystem(source);
  for (const theme of out.themes) {
    const get = (p: string) => theme.tokens.find((t) => t.path === p)?.value;
    // AAA for primary, AA for subtle — the contract solveTextL guarantees
    expect(contrastRatio(get("text.primary"), get("bg.canvas"))!).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(get("text.subtle"), get("bg.canvas"))!).toBeGreaterThanOrEqual(4.5);
    expect(checkContrast([{ label: "p", fg: get("text.primary"), bg: get("bg.canvas"), level: "AAA" }]).filter((i) => i.level === "error")).toEqual([]);
  }
});

test("text holds on ALL canvas-class backgrounds (canvas/subtle/surface), both themes", () => {
  // The semantic set puts text on three neutral bg steps, not just the canvas —
  // solveTextL targets the worst-case step 3, so all nine pairs must gate clean.
  const { source } = scaffoldDesignSystem(spec);
  const out = deriveDesignSystem(source);
  expect(out.themes.length).toBe(2);
  for (const theme of out.themes) {
    const get = (p: string) => theme.tokens.find((t) => t.path === p)?.value;
    for (const bg of ["bg.canvas", "bg.subtle", "bg.surface"]) {
      const pairs = checkContrast([
        { label: `${theme.name}: text.primary on ${bg}`, fg: get("text.primary"), bg: get(bg), level: "AAA" },
        { label: `${theme.name}: text.subtle on ${bg}`, fg: get("text.subtle"), bg: get(bg) },
        { label: `${theme.name}: accent.text on ${bg}`, fg: get("accent.text"), bg: get(bg) },
      ]);
      expect(pairs.filter((i) => i.level === "error")).toEqual([]);
    }
  }
});

test("scaffold fills the system manifest (gated at AA)", () => {
  const { manifest } = scaffoldDesignSystem(spec);
  expect(manifest).toEqual({ gate: { level: "AA" } });
});

test("scaffold produces a starter design.json with an on-brand bracket", () => {
  const { evalSpec } = scaffoldDesignSystem(spec);
  expect(evalSpec.brief.adjectives).toEqual(["modern", "trustworthy"]);
  expect(evalSpec.cases.map((c) => c.expect).sort()).toEqual(["fail", "pass"]);
});

test("an empty color list is rejected, not silently scaffolded", () => {
  const { issues } = scaffoldDesignSystem({ brief: spec.brief, colors: [] });
  expect(issues.some((i) => i.level === "error")).toBe(true);
});
