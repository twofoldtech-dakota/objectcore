import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scanImprovable, IMPROVABLE_MARKER } from "../src/suggest";

test("scanImprovable harvests declared markers with line + reason", () => {
  const src = [
    "function a() {}",
    "// forge:improvable — the default body is too terse; enrich it",
    "function b() {}",
    "  // forge:improvable: strip the redundant header",
    "const x = 1;",
  ].join("\n");
  const found = scanImprovable(src);
  expect(found).toEqual([
    { line: 2, reason: "the default body is too terse; enrich it" },
    { line: 4, reason: "strip the redundant header" },
  ]);
});

test("scanImprovable returns empty when nothing is declared", () => {
  expect(scanImprovable("const y = 2;\n// just a normal comment\n")).toEqual([]);
});

test("the real scaffolder declares at least one Tier-A candidate", () => {
  // Phase 2 seeds a genuine backlog item; the loop has something to act on.
  const src = readFileSync(join(import.meta.dir, "..", "src", "scaffold.ts"), "utf8");
  const found = scanImprovable(src);
  expect(found.length).toBeGreaterThanOrEqual(1);
  expect(src).toContain(IMPROVABLE_MARKER);
});
