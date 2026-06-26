import { test, expect } from "bun:test";
import {
  classifyPath,
  findBoundaryViolations,
  assertWithinMutableSurface,
} from "../src/boundary";

test("classifyPath: the scaffolder generative logic is the mutable surface", () => {
  expect(classifyPath("packages/forge/src/scaffold.ts")).toBe("mutable");
  // Windows-style separators and a leading ./ normalize to the same thing.
  expect(classifyPath("packages\\forge\\src\\scaffold.ts")).toBe("mutable");
  expect(classifyPath("./packages/forge/src/scaffold.ts")).toBe("mutable");
});

test("classifyPath: the gate, seam, spec contract, and corpus are TCB", () => {
  expect(classifyPath("packages/eval/src/coverage.ts")).toBe("tcb");
  expect(classifyPath("packages/registry-core/src/derive.ts")).toBe("tcb");
  expect(classifyPath("packages/forge/src/types.ts")).toBe("tcb");
  expect(classifyPath("packages/forge/test/golden/skill-only.json")).toBe("tcb");
  expect(classifyPath("scripts/eval.ts")).toBe("tcb");
  expect(classifyPath(".github/workflows/ci.yml")).toBe("tcb");
  // The enforcer must not be able to move its own fence.
  expect(classifyPath("packages/forge/src/boundary.ts")).toBe("tcb");
  // Nor edit what decides its own admission.
  expect(classifyPath("packages/forge/src/improve.ts")).toBe("tcb");
  expect(classifyPath("scripts/forge-improve.ts")).toBe("tcb");
});

test("classifyPath: anything else is 'other' (default-deny — not silently allowed)", () => {
  // A path nobody enumerated as TCB is still NOT mutable, so it cannot be
  // self-edited. Safety does not depend on the TCB list being exhaustive.
  expect(classifyPath("packages/release/src/provenance.ts")).toBe("other");
  expect(classifyPath("plugins/hello-objectcore/skills/x/SKILL.md")).toBe("other");
  expect(classifyPath("packages/forge/src/meta.ts")).toBe("other");
});

test("findBoundaryViolations: a scaffold-only diff is admissible", () => {
  expect(findBoundaryViolations(["packages/forge/src/scaffold.ts"])).toEqual([]);
});

test("findBoundaryViolations: a TCB touch is rejected with a precise reason", () => {
  const v = findBoundaryViolations([
    "packages/forge/src/scaffold.ts",
    "packages/eval/src/coverage.ts",
  ]);
  expect(v).toHaveLength(1);
  expect(v[0]!.path).toBe("packages/eval/src/coverage.ts");
  expect(v[0]!.zone).toBe("tcb");
  expect(v[0]!.reason).toMatch(/evaluator/);
});

test("findBoundaryViolations: an 'other' path is rejected too (default-deny)", () => {
  const v = findBoundaryViolations(["packages/forge/src/meta.ts"]);
  expect(v).toHaveLength(1);
  expect(v[0]!.zone).toBe("other");
  expect(v[0]!.reason).toMatch(/outside the mutable surface/);
});

test("assertWithinMutableSurface throws on a gate touch, passes on scaffold-only", () => {
  expect(() => assertWithinMutableSurface(["packages/forge/src/scaffold.ts"])).not.toThrow();
  expect(() =>
    assertWithinMutableSurface(["scripts/eval.ts"]),
  ).toThrow(/self-edit boundary violated/);
});
