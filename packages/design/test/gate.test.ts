import { test, expect } from "bun:test";
import { contrastRatio, relativeLuminance } from "../src/color";
import {
  checkContrast,
  checkTypeScale,
  checkSpacingGrid,
  computeFluidClamp,
  checkFluidClamp,
  checkDurationLadder,
  checkEasingMatch,
  M3_DURATIONS,
  M3_EASINGS,
} from "../src/gate";

const errs = (xs: { level: string }[]) => xs.filter((i) => i.level === "error");

// ── color / contrast ──
test("contrastRatio: black on white is 21:1", () => {
  expect(contrastRatio("#000000", "#ffffff")!).toBeCloseTo(21, 1);
});

test("relativeLuminance: white≈1, black≈0; oklch resolves", () => {
  expect(relativeLuminance("#ffffff")!).toBeCloseTo(1, 3);
  expect(relativeLuminance("#000000")!).toBeCloseTo(0, 3);
  // oklch white (L=1) ≈ white
  expect(relativeLuminance({ colorSpace: "oklch", components: [1, 0, 0] })!).toBeCloseTo(1, 1);
});

test("contrastRatio returns null for an unsupported (wide-gamut) space", () => {
  expect(contrastRatio({ colorSpace: "display-p3", components: [1, 0, 0] }, "#fff")).toBeNull();
});

test("checkContrast: passes 21:1, fails a 2.85:1 pair, warns on uncomputable", () => {
  expect(errs(checkContrast([{ label: "ok", fg: "#000000", bg: "#ffffff" }]))).toEqual([]);
  expect(errs(checkContrast([{ label: "bad", fg: "#999999", bg: "#ffffff" }])).length).toBe(1);
  const warn = checkContrast([{ label: "p3", fg: { colorSpace: "display-p3", components: [1, 0, 0] }, bg: "#fff" }]);
  expect(warn.some((i) => i.level === "warning")).toBe(true);
});

test("checkContrast: non-text uses a 3:1 floor", () => {
  // ~3.5:1 grey on white passes the 3:1 non-text floor but would fail 4.5:1 text
  expect(errs(checkContrast([{ label: "border", fg: "#8a8a8a", bg: "#ffffff", nonText: true }]))).toEqual([]);
  expect(errs(checkContrast([{ label: "text", fg: "#8a8a8a", bg: "#ffffff" }])).length).toBe(1);
});

// ── type scale ──
test("checkTypeScale: a clean 1.25 scale passes; a broken step fails", () => {
  expect(errs(checkTypeScale([16, 20, 25, 31.25], { ratio: 1.25 }))).toEqual([]);
  expect(errs(checkTypeScale([16, 20, 30], { ratio: 1.25 })).length).toBe(1);
});

// ── spacing grid ──
test("checkSpacingGrid: multiples of the base pass; an off-grid value fails", () => {
  expect(errs(checkSpacingGrid([8, 16, 24, 32], { base: 8 }))).toEqual([]);
  expect(errs(checkSpacingGrid([8, 16, 20], { base: 8 })).length).toBe(1);
});

// ── fluid clamp ──
test("computeFluidClamp reproduces the canonical 16@400 → 19@1280 example", () => {
  const c = computeFluidClamp({ minPx: 16, maxPx: 19, minVw: 400, maxVw: 1280 });
  expect(c.minRem).toBeCloseTo(1, 4);
  expect(c.slopeVw).toBeCloseTo(0.3409, 3);
  expect(c.interceptRem).toBeCloseTo(0.9148, 3);
});

test("checkFluidClamp: matching coeffs pass, a wrong slope fails", () => {
  const inputs = { minPx: 16, maxPx: 19, minVw: 400, maxVw: 1280 };
  const good = computeFluidClamp(inputs);
  expect(errs(checkFluidClamp(good, inputs))).toEqual([]);
  expect(errs(checkFluidClamp({ ...good, slopeVw: good.slopeVw + 0.5 }, inputs)).length).toBe(1);
});

// ── motion ──
test("checkDurationLadder: M3 values pass, off-ladder warns", () => {
  expect(checkDurationLadder([50, 150, 250, 1000])).toEqual([]);
  expect(checkDurationLadder([120]).some((i) => i.level === "warning")).toBe(true);
  expect(M3_DURATIONS).toContain(300);
});

test("checkEasingMatch: exact M3 standard passes, a deviation warns", () => {
  expect(checkEasingMatch([0.2, 0, 0, 1], M3_EASINGS.standard!)).toEqual([]);
  expect(checkEasingMatch([0.5, 0, 0, 1], M3_EASINGS.standard!).some((i) => i.level === "warning")).toBe(true);
});
