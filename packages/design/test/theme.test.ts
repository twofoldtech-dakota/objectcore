import { test, expect } from "bun:test";
import { mergeTrees, applyResolver, type Resolver } from "../src/theme";

test("mergeTrees: a later token wholly overrides an earlier one", () => {
  const merged = mergeTrees(
    { a: { $type: "number", $value: 1 } },
    { a: { $type: "number", $value: 2 } },
  );
  expect((merged.a as { $value: number }).$value).toBe(2);
});

test("mergeTrees: groups merge recursively (siblings preserved)", () => {
  const merged = mergeTrees(
    { g: { x: { $type: "number", $value: 1 } } },
    { g: { y: { $type: "number", $value: 2 } } },
  );
  expect(Object.keys(merged.g as object).sort()).toEqual(["x", "y"]);
});

const sets = {
  primitives: { color: { $type: "color", white: { $value: "#ffffff" }, black: { $value: "#000000" } } },
  "semantic-light": { bg: { $type: "color", $value: "{color.white}" } },
  "semantic-dark": { bg: { $type: "color", $value: "{color.black}" } },
};
const resolver: Resolver = {
  resolutionOrder: ["primitives", "theme"],
  modifiers: [{ name: "theme", contexts: { light: ["semantic-light"], dark: ["semantic-dark"] } }],
};

test("applyResolver selects the right sets per context and resolves over the merge", () => {
  const light = applyResolver(sets, resolver, { theme: "light" });
  const dark = applyResolver(sets, resolver, { theme: "dark" });
  expect(light.issues.filter((i) => i.level === "error")).toEqual([]);
  expect(light.resolved.find((t) => t.path === "bg")?.value).toBe("#ffffff");
  expect(dark.resolved.find((t) => t.path === "bg")?.value).toBe("#000000");
});

test("applyResolver reports an unknown set name", () => {
  const bad: Resolver = { resolutionOrder: ["ghost"], modifiers: [] };
  const r = applyResolver(sets, bad, {});
  expect(r.issues.some((i) => i.level === "error" && i.message.includes("ghost"))).toBe(true);
});

test("applyResolver warns when a modifier's context value is missing", () => {
  const r = applyResolver(sets, resolver, {}); // no { theme }
  expect(r.issues.some((i) => i.level === "warning" && i.message.includes("theme"))).toBe(true);
});
