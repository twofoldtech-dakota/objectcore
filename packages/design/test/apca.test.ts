import { test, expect } from "bun:test";
import { apcaLc, checkApca } from "../src/apca";
import { contrastRatio } from "../src/color";

test("apcaLc: dark text on light bg is high positive; reverse is negative", () => {
  expect(apcaLc("#000000", "#ffffff")!).toBeGreaterThan(100);
  expect(apcaLc("#ffffff", "#000000")!).toBeLessThan(-90);
});

// Canonical APCA-W3 0.1.x reference vectors, pinned tight (<0.1 Lc) so a constant or
// exponent transcription typo in apca.ts cannot pass. The two mid-gray vectors are the
// load-bearing ones: #888/#fff catches a NORM_BG/NORM_TXT swap (~0.7 Lc drift) and
// #aaa/#000 a REV_TXT/REV_BG swap (~2.3 Lc) — the pure black/white pairs barely move.
// Update these deliberately if the (beta, non-frozen) upstream constants ever change.
test("apcaLc matches the APCA-W3 0.1.x reference vectors within 0.1 Lc", () => {
  expect(apcaLc("#888888", "#ffffff")!).toBeCloseTo(63.06, 1);
  expect(apcaLc("#000000", "#ffffff")!).toBeCloseTo(106.04, 1);
  expect(apcaLc("#ffffff", "#000000")!).toBeCloseTo(-107.88, 1);
  expect(apcaLc("#aaaaaa", "#000000")!).toBeCloseTo(-56.24, 1);
});

test("apcaLc returns null for an unsupported color space", () => {
  expect(apcaLc({ colorSpace: "rec2020", components: [1, 1, 1] }, "#000")).toBeNull();
});

test("checkApca: a strong pair passes; a weak pair warns (never errors)", () => {
  expect(checkApca([{ label: "body", text: "#000000", bg: "#ffffff", targetLc: 75 }])).toEqual([]);
  const weak = checkApca([{ label: "weak", text: "#888888", bg: "#999999", targetLc: 75 }]);
  expect(weak.length).toBe(1);
  expect(weak.every((i) => i.level === "warning")).toBe(true);
});

test("the dark-mode divergence the research cited: WCAG passes AAA but APCA falls short", () => {
  // #B0B0B0 on #1E1E1E: WCAG ~7.7:1 (passes AAA 7:1) yet APCA Lc well under a body target
  expect(contrastRatio("#B0B0B0", "#1E1E1E")!).toBeGreaterThan(7);
  expect(Math.abs(apcaLc("#B0B0B0", "#1E1E1E")!)).toBeLessThan(70);
});
