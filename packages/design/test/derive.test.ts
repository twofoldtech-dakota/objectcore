import { test, expect } from "bun:test";
import { deriveDesignSystem, type DesignSystemSource } from "../src/derive";

const sets = {
  primitives: { color: { $type: "color", white: { $value: "#ffffff" }, black: { $value: "#000000" } } },
  "semantic-light": { bg: { $type: "color", $value: "{color.white}" } },
  "semantic-dark": { bg: { $type: "color", $value: "{color.black}" } },
};

test("no resolver ⇒ a single 'default' theme merging all sets", () => {
  const out = deriveDesignSystem({ sets: { primitives: sets.primitives, "semantic-light": sets["semantic-light"] } });
  expect(out.themes).toHaveLength(1);
  expect(out.themes[0]!.name).toBe("default");
  expect(out.themes[0]!.tokens.find((t) => t.path === "bg")?.value).toBe("#ffffff");
});

test("resolver + themes ⇒ one derived theme per permutation with distinct values", () => {
  const source: DesignSystemSource = {
    sets,
    resolver: {
      resolutionOrder: ["primitives", "theme"],
      modifiers: [{ name: "theme", contexts: { light: ["semantic-light"], dark: ["semantic-dark"] } }],
    },
    themes: [
      { name: "light", context: { theme: "light" } },
      { name: "dark", context: { theme: "dark" } },
    ],
  };
  const out = deriveDesignSystem(source);
  expect(out.issues.filter((i) => i.level === "error")).toEqual([]);
  expect(out.themes.map((t) => t.name)).toEqual(["light", "dark"]);
  const light = out.themes.find((t) => t.name === "light")!;
  const dark = out.themes.find((t) => t.name === "dark")!;
  expect(light.tokens.find((t) => t.path === "bg")?.value).toBe("#ffffff");
  expect(dark.tokens.find((t) => t.path === "bg")?.value).toBe("#000000");
});

test("resolution issues are theme-prefixed", () => {
  const out = deriveDesignSystem({
    sets,
    resolver: { resolutionOrder: ["ghost"], modifiers: [] },
    themes: [{ name: "light", context: {} }],
  });
  expect(out.issues.some((i) => i.message.startsWith("[light]"))).toBe(true);
});

test("deriveDesignSystem is pure (same input → equal output)", () => {
  const source = { sets: { primitives: sets.primitives } };
  expect(deriveDesignSystem(source)).toEqual(deriveDesignSystem(source));
});
