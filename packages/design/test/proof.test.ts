import { test, expect } from "bun:test";
import { proveContrast, checkContractContrast } from "../src/proof";
import { CONTRACT_PAIRS, EXEMPT_PAIRS } from "../src/roles";
import { ProofSink } from "../src/sinks";
import type { DesignSystemOutput, DerivedTheme } from "../src/derive";

const theme = (name: string, roles: Record<string, unknown>): DerivedTheme => ({
  name,
  context: {},
  tokens: Object.entries(roles).map(([path, value]) => ({ path, type: "color", value })),
});
const output = (...themes: DerivedTheme[]): DesignSystemOutput => ({ themes, issues: [] });

/** Full contract, all gated pairs clear AA; text.disabled deliberately FAILS (exempt). */
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

test("proveContrast measures every gated pair AND every exempt row of a full contract", () => {
  const entries = proveContrast(output(theme("light", FULL)), { level: "AA" });
  expect(entries.length).toBe(CONTRACT_PAIRS.length + EXEMPT_PAIRS.length);
  expect(entries.filter((e) => e.exempt).length).toBe(EXEMPT_PAIRS.length);
  const primary = entries.find((e) => e.label === "text.primary on bg.base")!;
  expect(primary.theme).toBe("light");
  expect(primary.required).toBe(4.5);
  expect(primary.ratio!).toBeGreaterThan(7);
  expect(primary.pass).toBe(true);
  const ring = entries.find((e) => e.label === "accent.focus-ring on bg.raised")!;
  expect(ring.kind).toBe("non-text");
  expect(ring.required).toBe(3); // 1.4.11 floor, level-independent
});

test("the declared level drives the required ratio (AA 4.5 → AAA 7 for text)", () => {
  const aaa = proveContrast(output(theme("light", FULL)), { level: "AAA" });
  const primary = aaa.find((e) => e.label === "text.primary on bg.base")!;
  expect(primary.level).toBe("AAA");
  expect(primary.required).toBe(7);
});

test("gate ≡ proof: checkContractContrast is exactly the failing non-exempt entries", () => {
  const clean = output(theme("light", FULL));
  expect(checkContractContrast(clean, { level: "AA" })).toEqual([]);

  // Wash out the accent: fails on every bg it sits on AND under accent.on-accent.
  const broken = output(theme("light", { ...FULL, "accent.default": "#9999ff" }));
  const entries = proveContrast(broken, { level: "AA" });
  const failing = entries.filter((e) => !e.pass && !e.exempt);
  const issues = checkContractContrast(broken, { level: "AA" });
  expect(issues.length).toBe(failing.length);
  expect(issues.length).toBeGreaterThan(0);
  expect(new Set(issues.map((i) => i.token))).toEqual(new Set(failing.map((e) => `${e.theme}: ${e.label}`)));
  const first = issues.find((i) => i.token === "light: accent.default on bg.base")!;
  expect(first.level).toBe("error");
  expect(first.message).toMatch(/^contrast \d+\.\d\d:1 is below the 4\.5:1 floor \(AA\)$/);
});

test("an exempt pair is measured (and may fail) but NEVER gates", () => {
  const entries = proveContrast(output(theme("light", FULL)), { level: "AA" });
  const disabled = entries.find((e) => e.label === "text.disabled on bg.base")!;
  expect(disabled.exempt).toBe(true);
  expect(disabled.pass).toBe(false); // #aaaaaa on white is ~2.3:1 — measured honestly
  const issues = checkContractContrast(output(theme("light", FULL)), { level: "AA" });
  expect(issues.some((i) => i.token?.includes("text.disabled"))).toBe(false);
});

test("an uncomputable color yields ratio null + pass false and a WARNING — never a silent pass", () => {
  const p3 = { colorSpace: "display-p3", components: [0, 0, 0] };
  const broken = output(theme("light", { ...FULL, "text.primary": p3 }));
  const entries = proveContrast(broken, { level: "AA" });
  const e = entries.find((x) => x.label === "text.primary on bg.base")!;
  expect(e.ratio).toBeNull();
  expect(e.pass).toBe(false);
  const issues = checkContractContrast(broken, { level: "AA" });
  const warnings = issues.filter((i) => i.token?.startsWith("light: text.primary"));
  expect(warnings.length).toBe(3); // one per canvas bg
  expect(warnings.every((i) => i.level === "warning" && i.message.includes("could not compute"))).toBe(true);
});

test("includeLegacy proves the pre-014 pairs for a narrow legacy system", () => {
  const legacy = theme("light", {
    "bg.canvas": "#ffffff", "bg.subtle": "#f7f7f7", "bg.surface": "#f2f2f2",
    "text.primary": "#111111", "text.subtle": "#444444", "accent.text": "#0000aa",
  });
  expect(proveContrast(output(legacy), { level: "AA" }).length).toBe(1); // contract overlap only
  const entries = proveContrast(output(legacy), { level: "AA", includeLegacy: true });
  expect(entries.length).toBe(9);
  const primary = entries.find((e) => e.label === "text.primary on bg.canvas")!;
  expect(primary.level).toBe("AAA"); // the legacy pin
  expect(primary.required).toBe(7);
  expect(entries.every((e) => e.pass)).toBe(true);
});

test("proveContrast is deterministic: repeat runs are identical, gated rows sort before exempt", () => {
  const out = output(theme("light", FULL), theme("dark", FULL));
  const a = proveContrast(out, { level: "AA", includeLegacy: true });
  const b = proveContrast(out, { level: "AA", includeLegacy: true });
  expect(a).toEqual(b);
  expect(a.map((e) => e.theme)).toEqual([...a.map((e) => e.theme)].sort((x, y) => (x === y ? 0 : x === "light" ? -1 : 1))); // theme output order preserved
  const light = a.filter((e) => e.theme === "light");
  const firstExempt = light.findIndex((e) => e.exempt);
  expect(light.slice(firstExempt).every((e) => e.exempt)).toBe(true);
});

test("ProofSink emits contrast-proof.json whose JSON is exactly proveContrast", () => {
  const out = output(theme("light", FULL));
  const files = new ProofSink({ level: "AA" }).emit(out);
  expect(files.map((f) => f.path)).toEqual(["contrast-proof.json"]);
  expect(JSON.parse(files[0]!.content)).toEqual(JSON.parse(JSON.stringify(proveContrast(out, { level: "AA" }))));
});
