import { test, expect } from "bun:test";
import { apcaLc, checkApca } from "../src/apca";
import { contrastRatio } from "../src/color";

test("apcaLc: dark text on light bg is high positive; reverse is negative", () => {
  expect(apcaLc("#000000", "#ffffff")!).toBeGreaterThan(100);
  expect(apcaLc("#ffffff", "#000000")!).toBeLessThan(-90);
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
