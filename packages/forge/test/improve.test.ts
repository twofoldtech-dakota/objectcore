import { test, expect } from "bun:test";
import { ADMISSION_CHECKS, decideAdmission, formatAdmission } from "../src/improve";

test("ADMISSION_CHECKS enumerates the three ordered gates", () => {
  expect(ADMISSION_CHECKS.map((c) => c.id)).toEqual(["boundary", "meta-eval", "full-gate"]);
});

test("admitted only when the boundary is clean AND the gate is green", () => {
  const r = decideAdmission({ changedPaths: ["packages/forge/src/scaffold.ts"], gateGreen: true });
  expect(r.admitted).toBe(true);
  expect(r.reasons).toEqual([]);
  expect(formatAdmission(r)).toMatch(/ADMITTED/);
});

test("a boundary violation rejects even if the gate would be green", () => {
  const r = decideAdmission({
    changedPaths: ["packages/forge/src/scaffold.ts", "packages/eval/src/coverage.ts"],
    gateGreen: true,
  });
  expect(r.admitted).toBe(false);
  expect(r.boundaryViolations).toHaveLength(1);
  expect(formatAdmission(r)).toMatch(/REJECTED/);
});

test("a boundary touch on the admission pipeline itself is rejected", () => {
  // The optimizer must not edit what decides its own admission.
  const r = decideAdmission({ changedPaths: ["packages/forge/src/improve.ts"], gateGreen: true });
  expect(r.admitted).toBe(false);
  expect(r.boundaryViolations[0]!.zone).toBe("tcb");
});

test("a red gate rejects even when the boundary is clean", () => {
  const r = decideAdmission({ changedPaths: ["packages/forge/src/scaffold.ts"], gateGreen: false });
  expect(r.admitted).toBe(false);
  expect(r.reasons).toContain("the full gate (`bun run check`) is red");
});

test("boundary-clean but gate-not-run is not admitted", () => {
  const r = decideAdmission({ changedPaths: ["packages/forge/src/scaffold.ts"], gateGreen: null });
  expect(r.admitted).toBe(false);
  expect(r.reasons).toContain("the full gate was not run");
});
