import { test, expect } from "bun:test";
import { listPresets, getPreset, instantiatePreset } from "../src/presets";
import { deriveDesignSystem, type DerivedTheme } from "../src/derive";
import { relativeLuminance } from "../src/color";
import type { ScaffoldResult } from "../src/scaffold";

const errors = (r: ScaffoldResult) => r.issues.filter((i) => i.level === "error");
const warnings = (r: ScaffoldResult) => r.issues.filter((i) => i.level === "warning");
const roleValue = (theme: DerivedTheme, path: string): unknown =>
  theme.tokens.find((t) => t.path === path)?.value;

test("listPresets renders the curated inventory: inkwell (6 themes) + cathode (9), both AAA", () => {
  const presets = listPresets();
  expect(presets.map((p) => p.name)).toEqual(["inkwell", "cathode"]);
  const [inkwell, cathode] = presets;
  expect(inkwell!.themes.map((t) => t.name)).toEqual(["paper", "ink", "study", "kiln", "arboretum", "nocturne"]);
  expect(cathode!.themes.map((t) => t.name)).toEqual([
    "glass", "daylight", "terminal", "blueprint", "ledger", "manila", "litmus", "sonar", "redline",
  ]);
  for (const p of presets) {
    expect(p.level).toBe("AAA");
    expect(p.description.length).toBeGreaterThan(0);
    expect(p.brief.adjectives.length).toBeGreaterThan(0);
    // One default per appearance; the overall default (themes[0]) carries the flag.
    expect(p.themes.filter((t) => t.default && t.appearance === "light").length).toBe(1);
    expect(p.themes.filter((t) => t.default && t.appearance === "dark").length).toBe(1);
    expect(p.themes[0]!.default).toBe(true);
    for (const t of p.themes) expect(t.description!.length).toBeGreaterThan(0);
  }
  expect(getPreset("inkwell")?.version).toBe("2.2.0");
  expect(getPreset("cathode")?.version).toBe("1.2.1");
});

// The headline: the machine-checked proof of the POC claims — every contract pair
// in every theme of BOTH presets clears AAA (coverage full, zero carve-outs).
test("both full presets instantiate with ZERO error issues at AAA", () => {
  for (const info of listPresets()) {
    const r = instantiatePreset(info.name);
    expect({ preset: info.name, errors: errors(r) }).toEqual({ preset: info.name, errors: [] });
    expect(r.manifest).toEqual({
      gate: { level: "AAA", coverage: "full" },
      seed: { preset: info.name, version: info.version, themes: info.themes.map((t) => t.name) },
    });
    expect(r.source.themes!.length).toBe(info.themes.length);
  }
});

test("the one-shot conversion left no POC namespace refs behind", () => {
  for (const info of listPresets()) {
    const raw = JSON.stringify(instantiatePreset(info.name).source.sets);
    expect(raw).not.toContain("{inkwell.");
    expect(raw).not.toContain("{cathode.");
  }
});

test("subsetting keeps only the selected semantic sets (no ramp pruning) and still gates green", () => {
  const r = instantiatePreset("inkwell", { themes: ["paper", "nocturne"] });
  expect(errors(r)).toEqual([]);
  expect(Object.keys(r.source.sets).sort()).toEqual(["primitives", "semantic-nocturne", "semantic-paper", "shared"]);
  expect(r.source.themes!.map((t) => t.name)).toEqual(["paper", "nocturne"]);
  expect(r.manifest?.seed?.themes).toEqual(["paper", "nocturne"]);
  // The full palette travels: every ramp survives even a 2-theme subset.
  const primitives = r.source.sets.primitives as { color: Record<string, unknown> };
  expect(Object.keys(primitives.color).filter((k) => !k.startsWith("$")).sort()).toEqual(
    ["bronze", "clay", "moss", "neutral", "ochre"],
  );
});

test("unknown preset refuses with an error naming the valid options", () => {
  const r = instantiatePreset("brutalist");
  expect(errors(r).map((i) => i.message)).toEqual([
    "unknown preset `brutalist` — valid presets: inkwell, cathode",
  ]);
  expect(r.source.sets).toEqual({});
});

test("unknown theme and empty subset refuse with errors naming the valid themes", () => {
  const bad = instantiatePreset("cathode", { themes: ["glass", "neon"] });
  expect(errors(bad).length).toBe(1);
  expect(errors(bad)[0]!.message).toContain("no theme `neon`");
  expect(errors(bad)[0]!.message).toContain("glass, daylight, terminal");
  expect(bad.source.sets).toEqual({});

  const empty = instantiatePreset("inkwell", { themes: [] });
  expect(errors(empty).length).toBe(1);
  expect(errors(empty)[0]!.message).toContain("empty theme subset");
});

test("a single-appearance subset warns (never errors) about the missing appearance", () => {
  const lightOnly = instantiatePreset("inkwell", { themes: ["paper"] });
  expect(errors(lightOnly)).toEqual([]);
  expect(warnings(lightOnly).map((i) => i.message)).toEqual([
    "the theme selection has no dark theme — the seeded system is light-only",
  ]);
  const full = instantiatePreset("inkwell");
  expect(warnings(full)).toEqual([]);
});

test("the default theme is ordered FIRST regardless of the requested order (themes[0] -> :root)", () => {
  const r = instantiatePreset("cathode", { themes: ["redline", "daylight", "glass"] });
  // glass (the overall default) first, daylight (light default) next, then preset order.
  expect(r.source.themes!.map((t) => t.name)).toEqual(["glass", "daylight", "redline"]);
  expect(r.manifest?.seed?.themes).toEqual(["glass", "daylight", "redline"]);
  expect(instantiatePreset("inkwell").source.themes![0]!.name).toBe("paper");
});

test("opts.name renames the seeded system's brief; the on-brand bracket ships in evalSpec", () => {
  const r = instantiatePreset("inkwell", { name: "seed-smoke" });
  expect(r.evalSpec.brief.name).toBe("seed-smoke");
  expect(r.evalSpec.brief.adjectives).toContain("editorial");
  for (const info of listPresets()) {
    const cases = instantiatePreset(info.name).evalSpec.cases;
    expect(cases.some((c) => c.expect === "pass")).toBe(true);
    expect(cases.some((c) => c.expect === "fail")).toBe(true);
  }
});

test("primitive $extensions provenance survives conversion AND derivation", () => {
  const r = instantiatePreset("inkwell", { themes: ["paper", "ink"] });
  const paper = deriveDesignSystem(r.source).themes[0]!;
  const step = paper.tokens.find((t) => t.path === "color.neutral.50")!;
  expect(step.extensions).toEqual({ "ai.objectcore.derived": { source: true } });
  // Semantic aliases keep their OWN (absent) extensions, never their target's.
  expect(paper.tokens.find((t) => t.path === "bg.base")!.extensions).toBeUndefined();
});

test("every theme's declared appearance matches the measured relativeLuminance(bg.base)", () => {
  for (const info of listPresets()) {
    const out = deriveDesignSystem(instantiatePreset(info.name).source);
    for (const themeInfo of info.themes) {
      const theme = out.themes.find((t) => t.name === themeInfo.name)!;
      const lum = relativeLuminance(roleValue(theme, "bg.base"))!;
      expect({ theme: `${info.name}/${themeInfo.name}`, appearance: themeInfo.appearance }).toEqual({
        theme: `${info.name}/${themeInfo.name}`,
        appearance: lum >= 0.5 ? "light" : "dark",
      });
    }
  }
});

test("instantiation is deterministic: two runs are byte-identical", () => {
  for (const info of listPresets()) {
    const a = instantiatePreset(info.name, { themes: [info.themes[0]!.name, info.themes[2]!.name] });
    const b = instantiatePreset(info.name, { themes: [info.themes[0]!.name, info.themes[2]!.name] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  }
});
