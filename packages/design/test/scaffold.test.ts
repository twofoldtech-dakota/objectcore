import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scaffoldDesignSystem, type ScaffoldSpec } from "../src/scaffold";
import { validateTokens } from "../src/schema";
import { deriveDesignSystem, type DerivedTheme } from "../src/derive";
import { contrastRatio } from "../src/color";
import { REQUIRED_ROLES } from "../src/roles";
import { checkContractContrast } from "../src/proof";

const spec: ScaffoldSpec = {
  brief: { name: "objectcore", adjectives: ["modern", "trustworthy"] },
  colors: [{ name: "accent", hue: 250 }],
  baseUnit: 4,
  baseFontPx: 16,
  typeRatio: 1.25,
};

/** The base spec plus all three status families — the full-contract shape. */
const statusSpec: ScaffoldSpec = {
  ...spec,
  colors: [
    { name: "accent", hue: 250 },
    { name: "success", hue: 150, chroma: 0.13 },
    { name: "warning", hue: 80, chroma: 0.14 },
    { name: "danger", hue: 25, chroma: 0.16 },
  ],
};

// The repo's own committed brief — the scaffold must widen it cleanly IN MEMORY
// (the on-disk migration of design/objectcore is integration's job, not this test's).
const objectcoreSpec: ScaffoldSpec = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "..", "..", "design", "objectcore", "brief.json"), "utf8"),
);

// Synthetic stress briefs — "accessible by construction" must survive unusual
// inputs, not just the friendly defaults.
const extremeSpec: ScaffoldSpec = {
  brief: { name: "extreme", adjectives: ["loud", "vivid"] },
  colors: [
    { name: "neutral", hue: 350, chroma: 0.03 }, // a CHROMATIC neutral, supplied
    { name: "accent", hue: 350, chroma: 0.35 }, // near the hue-wheel seam, max-ish chroma
    { name: "success", hue: 110, chroma: 0.3 },
    { name: "warning", hue: 95, chroma: 0.32 },
    { name: "danger", hue: 29, chroma: 0.35 },
  ],
  baseUnit: 8,
};
const quietSpec: ScaffoldSpec = {
  brief: { name: "quiet", adjectives: ["calm"] },
  colors: [{ name: "accent", hue: 110, chroma: 0.3 }], // high-luminance hue band, no status families
};

const CANVAS_BGS = ["bg.base", "bg.surface", "bg.raised"] as const;
const LEGACY_ROLES = ["bg.canvas", "bg.subtle", "text.subtle", "accent.solid", "accent.solid-hover", "accent.text", "border.default"];

const derive = (s: ScaffoldSpec) => deriveDesignSystem(scaffoldDesignSystem(s).source);
const val = (theme: DerivedTheme, path: string) => theme.tokens.find((t) => t.path === path)?.value;
const ratio = (theme: DerivedTheme, fg: string, bg: string) => contrastRatio(val(theme, fg), val(theme, bg))!;

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
  const { source } = scaffoldDesignSystem(statusSpec);
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

test("the FULL role contract is emitted — and no legacy role names, both themes", () => {
  const out = derive(statusSpec);
  expect(out.themes.length).toBe(2);
  for (const theme of out.themes) {
    for (const role of REQUIRED_ROLES) expect(val(theme, role)).toBeDefined();
    for (const legacy of LEGACY_ROLES) expect(val(theme, legacy)).toBeUndefined();
  }
});

test("text roles hold on ALL canvas-class backgrounds (base/surface/raised), both themes", () => {
  // solveTextL targets the worst-case neutral step 3 (bg.raised), so every pair
  // clears with margin: emphasis/primary at 7:1 (step 12), secondary/muted at 4.5:1.
  for (const theme of derive(spec).themes) {
    for (const bg of CANVAS_BGS) {
      expect(ratio(theme, "text.emphasis", bg)).toBeGreaterThanOrEqual(7);
      expect(ratio(theme, "text.primary", bg)).toBeGreaterThanOrEqual(7);
      expect(ratio(theme, "text.secondary", bg)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(theme, "text.muted", bg)).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("the dual-constraint accent solve holds, recomputed from the derived values", () => {
  for (const theme of derive(spec).themes) {
    // accent.default as text on every canvas bg AND on its own subtle wash…
    for (const bg of CANVAS_BGS) expect(ratio(theme, "accent.default", bg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(theme, "accent.default", "accent.subtle-bg")).toBeGreaterThanOrEqual(4.5);
    // …AND accent.on-accent sitting on the solid — the other half of the dual solve.
    expect(ratio(theme, "accent.on-accent", "accent.default")).toBeGreaterThanOrEqual(4.5);
    // hover is one solve step MORE extreme, so its on-accent pair only gains contrast.
    expect(ratio(theme, "accent.on-accent", "accent.hover")).toBeGreaterThanOrEqual(
      ratio(theme, "accent.on-accent", "accent.default"),
    );
  }
});

test("accent.focus-ring aliases accent.default (same resolved value, 3:1 on every bg)", () => {
  for (const theme of derive(spec).themes) {
    expect(val(theme, "accent.focus-ring")).toEqual(val(theme, "accent.default"));
    for (const bg of CANVAS_BGS) expect(ratio(theme, "accent.focus-ring", bg)).toBeGreaterThanOrEqual(3);
  }
});

test("border.input clears the 1.4.11 floor on the gated backgrounds, both themes", () => {
  for (const theme of derive(spec).themes) {
    expect(ratio(theme, "border.input", "bg.base")).toBeGreaterThanOrEqual(3);
    expect(ratio(theme, "border.input", "bg.surface")).toBeGreaterThanOrEqual(3);
  }
});

test("status/solid roles pass their contract pairs, recomputed", () => {
  for (const theme of derive(statusSpec).themes) {
    for (const s of ["success", "warning", "danger"]) {
      expect(ratio(theme, `status.${s}-text`, `status.${s}-bg`)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(theme, `solid.on-${s}`, `solid.${s}`)).toBeGreaterThanOrEqual(4.5);
      // solid.<s> is the family's step-11 alias; on-<s> is neutral step 1.
      expect(val(theme, `solid.${s}`)).toEqual(val(theme, `color.${s}.${theme.name}.11`));
      expect(val(theme, `solid.on-${s}`)).toEqual(val(theme, "color.neutral." + theme.name + ".1"));
    }
  }
});

test("status/solid roles are emitted ONLY for the families the brief names", () => {
  for (const theme of derive(spec).themes) {
    expect(theme.tokens.some((t) => t.path.startsWith("status.") || t.path.startsWith("solid."))).toBe(false);
  }
  const partial = derive({ ...spec, colors: [...spec.colors, { name: "danger", hue: 25, chroma: 0.16 }] });
  for (const theme of partial.themes) {
    expect(val(theme, "status.danger-bg")).toBeDefined();
    expect(val(theme, "solid.on-danger")).toBeDefined();
    expect(val(theme, "status.success-bg")).toBeUndefined();
    expect(val(theme, "solid.warning")).toBeUndefined();
  }
});

test("the repo's own brief widens to a gate-passing full-contract system in memory", () => {
  const result = scaffoldDesignSystem(objectcoreSpec);
  expect(result.issues.filter((i) => i.level === "error")).toEqual([]);
  const out = deriveDesignSystem(result.source);
  expect(checkContractContrast(out, { level: "AA", includeLegacy: true })).toEqual([]);
  for (const theme of out.themes) {
    for (const role of REQUIRED_ROLES) expect(val(theme, role)).toBeDefined();
    for (const legacy of LEGACY_ROLES) expect(val(theme, legacy)).toBeUndefined();
  }
});

test("unusual hues/chromas still self-gate clean at AA — accessible BY CONSTRUCTION", () => {
  for (const s of [extremeSpec, quietSpec]) {
    const result = scaffoldDesignSystem(s);
    expect(result.issues.filter((i) => i.level === "error")).toEqual([]);
    const out = deriveDesignSystem(result.source);
    expect(checkContractContrast(out, { level: "AA", includeLegacy: true })).toEqual([]);
  }
});

test("scaffolding is deterministic — the same brief expands byte-identically", () => {
  const a = scaffoldDesignSystem(statusSpec);
  const b = scaffoldDesignSystem(statusSpec);
  expect(JSON.stringify(a.source)).toBe(JSON.stringify(b.source));
  expect(a.manifest).toEqual(b.manifest);
  expect(a.evalSpec).toEqual(b.evalSpec);
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
