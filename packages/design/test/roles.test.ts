import { test, expect } from "bun:test";
import {
  CONTRACT_PAIRS,
  LEGACY_PAIRS,
  EXEMPT_PAIRS,
  REQUIRED_ROLES,
  contractPairInstances,
  contractPairs,
  checkContractCoverage,
} from "../src/roles";
import { checkContrast } from "../src/gate";
import type { DerivedTheme } from "../src/derive";

const theme = (name: string, roles: Record<string, string>): DerivedTheme => ({
  name,
  context: {},
  tokens: Object.entries(roles).map(([path, value]) => ({ path, type: "color", value })),
});

/** A full-contract theme whose gated pairs all clear AA (dark-on-light throughout). */
const FULL: Record<string, string> = {
  "bg.base": "#ffffff", "bg.surface": "#f2f2f2", "bg.raised": "#e8e8e8",
  "border.subtle": "#dddddd", "border.strong": "#999999", "border.input": "#555555",
  "text.emphasis": "#000000", "text.primary": "#111111", "text.secondary": "#222222",
  "text.muted": "#333333", "text.disabled": "#aaaaaa",
  "accent.default": "#0000ee", "accent.hover": "#0000aa", "accent.subtle-bg": "#eeeeff",
  "accent.on-accent": "#ffffff", "accent.focus-ring": "#0000ee",
  "status.success-bg": "#e8f5e9", "status.success-text": "#0b3d0f",
  "status.warning-bg": "#fff8e1", "status.warning-text": "#4d3800",
  "status.danger-bg": "#ffebee", "status.danger-text": "#7f1010",
  "solid.success": "#005500", "solid.on-success": "#ffffff",
  "solid.warning": "#664400", "solid.on-warning": "#ffffff",
  "solid.danger": "#990000", "solid.on-danger": "#ffffff",
};

/** The pre-014 narrow vocabulary (what design/objectcore speaks today). */
const LEGACY: Record<string, string> = {
  "bg.canvas": "#ffffff", "bg.subtle": "#f7f7f7", "bg.surface": "#f2f2f2",
  "text.primary": "#111111", "text.subtle": "#444444", "accent.text": "#0000aa",
};

test("CONTRACT_PAIRS encodes the plan-014 table: 29 pairs, 5 of them non-text", () => {
  expect(CONTRACT_PAIRS.length).toBe(29);
  expect(CONTRACT_PAIRS.filter((p) => p.kind === "non-text").length).toBe(5);
  // Spot-check one row per table section.
  expect(CONTRACT_PAIRS).toContainEqual({ fg: "text.muted", bg: "bg.raised", kind: "text" });
  expect(CONTRACT_PAIRS).toContainEqual({ fg: "accent.default", bg: "accent.subtle-bg", kind: "text" });
  expect(CONTRACT_PAIRS).toContainEqual({ fg: "accent.on-accent", bg: "accent.hover", kind: "text" });
  expect(CONTRACT_PAIRS).toContainEqual({ fg: "status.danger-text", bg: "status.danger-bg", kind: "text" });
  expect(CONTRACT_PAIRS).toContainEqual({ fg: "solid.on-warning", bg: "solid.warning", kind: "text" });
  expect(CONTRACT_PAIRS).toContainEqual({ fg: "border.input", bg: "bg.surface", kind: "non-text" });
  expect(CONTRACT_PAIRS).toContainEqual({ fg: "accent.focus-ring", bg: "bg.raised", kind: "non-text" });
  // No contract pair carries a level pin — text always gates at the DECLARED level.
  expect(CONTRACT_PAIRS.every((p) => p.level === undefined)).toBe(true);
});

test("LEGACY_PAIRS is the pre-014 STD trio byte-for-byte, incl. text.primary pinned at AAA", () => {
  expect(LEGACY_PAIRS.length).toBe(9);
  for (const bg of ["bg.canvas", "bg.subtle", "bg.surface"]) {
    expect(LEGACY_PAIRS).toContainEqual({ fg: "text.primary", bg, kind: "text", level: "AAA" });
    expect(LEGACY_PAIRS).toContainEqual({ fg: "text.subtle", bg, kind: "text", level: "AA" });
    expect(LEGACY_PAIRS).toContainEqual({ fg: "accent.text", bg, kind: "text", level: "AA" });
  }
});

test("REQUIRED_ROLES lists the full 28-role contract (text.disabled required as a role)", () => {
  expect(REQUIRED_ROLES.length).toBe(28);
  expect(new Set(REQUIRED_ROLES).size).toBe(28);
  for (const role of ["bg.raised", "border.input", "text.disabled", "accent.focus-ring", "status.warning-bg", "solid.on-danger"]) {
    expect(REQUIRED_ROLES).toContain(role);
  }
});

test("contractPairs emits every table pair (at the declared level) for a full-contract theme", () => {
  const pairs = contractPairs(theme("light", FULL), "AA");
  expect(pairs.length).toBe(29);
  expect(pairs.filter((p) => p.nonText).length).toBe(5);
  expect(pairs.every((p) => p.nonText || p.level === "AA")).toBe(true);
  const aaa = contractPairs(theme("light", FULL), "AAA");
  expect(aaa.every((p) => p.level === "AAA")).toBe(true);
});

test("contractPairs is presence-gated: only pairs whose BOTH roles resolve fire", () => {
  const narrow = contractPairs(theme("light", { "text.primary": "#111111", "bg.base": "#ffffff" }), "AA");
  expect(narrow.map((p) => p.label)).toEqual(["light: text.primary on bg.base"]);
  expect(contractPairs(theme("light", {}), "AA")).toEqual([]);
});

test("labels are theme-prefixed, matching the pre-014 gate issue tokens", () => {
  const pairs = contractPairs(theme("dark", FULL), "AA");
  expect(pairs.some((p) => p.label === "dark: text.primary on bg.surface")).toBe(true);
});

test("includeLegacy gates a narrow legacy system EXACTLY as pre-014: 9 pairs, primary at AAA", () => {
  const t = theme("light", LEGACY);
  expect(contractPairs(t, "AA").map((p) => p.label)).toEqual(["light: text.primary on bg.surface"]); // contract-only view
  const pairs = contractPairs(t, "AA", { includeLegacy: true });
  expect(pairs.length).toBe(9); // the STD trio × 3 bgs — the contract overlap dedups
  expect(pairs.find((p) => p.label === "light: text.primary on bg.surface")?.level).toBe("AAA");
  expect(pairs.filter((p) => p.level === "AAA").length).toBe(3);
  // ...and those 9 pairs still pass the gate (the fixture is accessible).
  expect(checkContrast(pairs).filter((i) => i.level === "error")).toEqual([]);
});

test("a (fg, bg) pair matched by contract AND legacy collapses to one pair at the stricter level", () => {
  const pairs = contractPairs(theme("light", FULL), "AA", { includeLegacy: true });
  // FULL lacks bg.canvas/bg.subtle/text.subtle/accent.text, so legacy adds no NEW pair —
  // it only pins the overlapping text.primary/bg.surface row up to AAA.
  expect(pairs.length).toBe(29);
  expect(pairs.filter((p) => p.label === "light: text.primary on bg.surface")).toEqual([
    expect.objectContaining({ level: "AAA" }),
  ]);
});

test("exempt pairs never reach the gate, only the instances view carries them", () => {
  const t = theme("light", FULL);
  const gated = contractPairInstances(t, "AA", { includeLegacy: true });
  expect(gated.some((p) => p.exempt)).toBe(false);
  expect(gated.some((p) => p.fgPath === "text.disabled")).toBe(false);
  const withExempt = contractPairInstances(t, "AA", { includeExempt: true });
  const exempt = withExempt.filter((p) => p.exempt);
  // FULL carries every role, so every EXEMPT_PAIRS row is present: 3 (text.disabled)
  // + 6 (border.subtle/strong) + 9 (status.*-bg) + 3 (accent.subtle-bg) + 1 (border.input/raised).
  expect(exempt.length).toBe(EXEMPT_PAIRS.length);
  expect(exempt).toContainEqual(expect.objectContaining({ fgPath: "border.input", bgPath: "bg.raised" }));
});

test("checkContractCoverage passes a full contract and names each missing role", () => {
  expect(checkContractCoverage(theme("light", FULL))).toEqual([]);
  const partial: Record<string, string> = { ...FULL };
  delete partial["accent.focus-ring"];
  delete partial["solid.on-danger"];
  const issues = checkContractCoverage(theme("dark", partial));
  expect(issues.map((i) => i.token)).toEqual(["dark: accent.focus-ring", "dark: solid.on-danger"]);
  expect(issues.every((i) => i.level === "error")).toBe(true);
});

test("the full-contract fixture passes the gate at AA in checkContrast terms", () => {
  const issues = checkContrast(contractPairs(theme("light", FULL), "AA", { includeLegacy: true }));
  expect(issues.filter((i) => i.level === "error")).toEqual([]);
});
