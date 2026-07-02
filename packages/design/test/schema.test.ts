import { test, expect } from "bun:test";
import { validateTokens } from "../src/schema";

const errs = (tree: Record<string, unknown>) => validateTokens(tree).filter((i) => i.level === "error");

test("a well-formed multi-type tree passes with zero errors", () => {
  const valid = {
    color: {
      $type: "color",
      gray: {
        "1": { $value: "#fcfcfc" },
        "12": { $value: { colorSpace: "oklch", components: [0.2, 0.01, 250] } },
      },
      accent: { $value: "{color.gray.12}" }, // alias inherits color
    },
    size: { $type: "dimension", body: { $value: { value: 16, unit: "px" } } },
    weight: {
      bold: { $type: "fontWeight", $value: 700 },
      regular: { $type: "fontWeight", $value: "regular" },
    },
    ratio: { $type: "number", $value: 1.25 },
    ease: { standard: { $type: "cubicBezier", $value: [0.2, 0, 0, 1] } },
    motion: { fast: { $type: "duration", $value: { value: 150, unit: "ms" } } },
    text: {
      body: {
        $type: "typography",
        $value: {
          fontFamily: ["Inter", "sans-serif"],
          fontSize: "{size.body}",
          fontWeight: "{weight.regular}",
          letterSpacing: { value: 0, unit: "px" },
          lineHeight: 1.5,
        },
      },
    },
  };
  expect(errs(valid)).toEqual([]);
});

test("an invalid $type is rejected", () => {
  const issues = errs({ x: { $type: "colour", $value: "#fff" } });
  expect(issues.some((i) => i.message.includes("13 DTCG types"))).toBe(true);
});

test("value shape must match the declared $type (dimension is an object, not a string)", () => {
  expect(errs({ x: { $type: "dimension", $value: "16px" } }).length).toBeGreaterThan(0);
});

test("cubicBezier must be 4 numbers with x in [0,1]", () => {
  expect(errs({ x: { $type: "cubicBezier", $value: [0.2, 0, 0] } }).length).toBeGreaterThan(0);
  expect(errs({ x: { $type: "cubicBezier", $value: [1.5, 0, 0, 1] } }).length).toBeGreaterThan(0);
});

test("a bad colorSpace is rejected; oklch is accepted", () => {
  expect(errs({ x: { $type: "color", $value: { colorSpace: "fake", components: [1, 2, 3] } } }).length).toBeGreaterThan(0);
  expect(errs({ x: { $type: "color", $value: { colorSpace: "oklch", components: [0.7, 0.1, 250] } } })).toEqual([]);
});

test("an unknown reserved ($-prefixed) property is rejected", () => {
  const issues = errs({ x: { $type: "number", $value: 1, $foo: true } });
  expect(issues.some((i) => i.message.includes("$foo"))).toBe(true);
});

test("$extensions is accepted on tokens and groups; unknown $-props stay rejected next to it", () => {
  // $extensions is a RESERVED prop (vendor passthrough, plan 014) — never an error...
  const ok = {
    ramp: {
      $type: "color",
      $extensions: { "ai.objectcore.note": "group-level vendor data" },
      "9": { $value: "#3355ff", $extensions: { "ai.objectcore.derived": { source: "poc" } } },
    },
  };
  expect(errs(ok)).toEqual([]);
  // ...and its presence must not loosen the reject-unknown floor for siblings.
  const mixed = errs({ x: { $type: "color", $value: "#fff", $extensions: {}, $foo: 1 } });
  expect(mixed.some((i) => i.message.includes("$foo"))).toBe(true);
});

test("a token with no determinable type errors (unless it's a pure alias)", () => {
  expect(errs({ x: { $value: 5 } }).some((i) => i.message.includes("determine"))).toBe(true);
  // a pure alias defers its type — no error here
  expect(errs({ a: { $type: "number", $value: 1 }, b: { $value: "{a}" } })).toEqual([]);
});

test("group $type is inherited by descendants", () => {
  // child has no $type but inherits `dimension` — and a string value is then wrong
  expect(errs({ spacing: { $type: "dimension", sm: { $value: "8px" } } }).length).toBeGreaterThan(0);
  expect(errs({ spacing: { $type: "dimension", sm: { $value: { value: 8, unit: "px" } } } })).toEqual([]);
});

test("token/group names may not contain dots or braces", () => {
  expect(errs({ "a.b": { $type: "number", $value: 1 } }).some((i) => i.message.includes("must not contain"))).toBe(true);
});

test("a token may not contain a child token", () => {
  const issues = errs({ x: { $type: "number", $value: 1, child: { $type: "number", $value: 2 } } });
  expect(issues.some((i) => i.message.includes("cannot contain a child"))).toBe(true);
});

test("typography composite validates its sub-fields", () => {
  const bad = {
    t: {
      $type: "typography",
      $value: { fontFamily: "Inter", fontSize: 16, fontWeight: 400, letterSpacing: { value: 0, unit: "px" }, lineHeight: 1.4 },
    },
  };
  // fontSize: 16 is not a dimension object
  expect(errs(bad).some((i) => i.message.includes("fontSize"))).toBe(true);
});
