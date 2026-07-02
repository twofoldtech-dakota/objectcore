import { test, expect } from "bun:test";
import { resolveAliases, flattenTokens } from "../src/resolve";

const errs = (r: { issues: { level: string; message: string }[] }) => r.issues.filter((i) => i.level === "error");
const byPath = (r: { resolved: { path: string; value: unknown; type: string; extensions?: Record<string, unknown> }[] }, p: string) =>
  r.resolved.find((t) => t.path === p);

test("flattenTokens lifts tokens to dotted paths with inherited type", () => {
  const flat = flattenTokens({ primitive: { $type: "dimension", base: { $value: { value: 8, unit: "px" } } } });
  const base = flat.find((t) => t.path === "primitive.base");
  expect(base?.type).toBe("dimension");
});

test("a chained alias resolves through every hop to the concrete value", () => {
  const r = resolveAliases({
    primitive: { $type: "dimension", base: { $value: { value: 8, unit: "px" } } },
    semantic: { gap: { $type: "dimension", $value: "{primitive.base}" } },
    comp: { card: { $type: "dimension", $value: "{semantic.gap}" } },
  });
  expect(errs(r)).toEqual([]);
  expect(byPath(r, "comp.card")?.value).toEqual({ value: 8, unit: "px" });
});

test("a reference nested inside a composite value is resolved", () => {
  const r = resolveAliases({
    size: { $type: "dimension", lg: { $value: { value: 24, unit: "px" } } },
    text: {
      h1: {
        $type: "typography",
        $value: { fontFamily: "Inter", fontSize: "{size.lg}", fontWeight: 700, letterSpacing: { value: 0, unit: "px" }, lineHeight: 1.2 },
      },
    },
  });
  expect(errs(r)).toEqual([]);
  expect((byPath(r, "text.h1")?.value as { fontSize: unknown }).fontSize).toEqual({ value: 24, unit: "px" });
});

test("a circular reference is reported, not followed forever", () => {
  const r = resolveAliases({
    a: { $type: "number", $value: "{b}" },
    b: { $type: "number", $value: "{a}" },
  });
  expect(errs(r).some((i) => i.message.includes("circular"))).toBe(true);
});

test("a dangling reference is reported", () => {
  const r = resolveAliases({ a: { $type: "number", $value: "{nope}" } });
  expect(errs(r).some((i) => i.message.includes("dangling"))).toBe(true);
});

test("a pure-alias token inherits its target's type", () => {
  const r = resolveAliases({
    p: { $type: "color", $value: "#ffffff" },
    alias: { $value: "{p}" },
  });
  expect(errs(r)).toEqual([]);
  const a = byPath(r, "alias");
  expect(a?.type).toBe("color");
  expect(a?.value).toBe("#ffffff");
});

test("a token's own $extensions is carried onto the ResolvedToken verbatim", () => {
  const ext = { "ai.objectcore.derived": { source: "oklch(0.62 0.15 264)" } };
  const r = resolveAliases({ p: { $type: "color", $value: "#3355ff", $extensions: ext } });
  expect(errs(r)).toEqual([]);
  expect(byPath(r, "p")?.extensions).toEqual(ext);
});

test("$extensions is NOT inherited from a group and NOT resolved through an alias", () => {
  const r = resolveAliases({
    ramp: {
      $type: "color",
      $extensions: { "ai.objectcore.group": true },
      base: { $value: "#112233", $extensions: { "ai.objectcore.own": true } },
    },
    alias: { $value: "{ramp.base}" },
  });
  expect(errs(r)).toEqual([]);
  // Own $extensions only: the child does not pick up the group's...
  expect(byPath(r, "ramp.base")?.extensions).toEqual({ "ai.objectcore.own": true });
  // ...and a pure alias resolves its VALUE but never adopts the target's $extensions.
  expect(byPath(r, "alias")?.value).toBe("#112233");
  expect(byPath(r, "alias")?.extensions).toBeUndefined();
});

test("resolved tokens come back sorted by path (deterministic)", () => {
  const r = resolveAliases({
    z: { $type: "number", $value: 1 },
    a: { $type: "number", $value: 2 },
  });
  expect(r.resolved.map((t) => t.path)).toEqual(["a", "z"]);
});
