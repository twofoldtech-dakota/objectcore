import { test, expect } from "bun:test";
import { renderSpecHtml, SpecHtmlSink, extractRamps, extractRoles, specProvenance, type SpecInput } from "../src/spec";
import { proveContrast } from "../src/proof";
import { deriveDesignSystem, type DesignSystemSource, type DesignSystemOutput } from "../src/derive";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Nested color group from dotted leaf paths (`"mist.50"` → `{ mist: { "50": … } }`),
 *  with optional per-leaf `$extensions`. */
function colorGroup(
  leaves: Record<string, unknown>,
  ext: Record<string, Record<string, unknown>> = {},
): Record<string, unknown> {
  const root: Record<string, unknown> = { $type: "color" };
  for (const [path, value] of Object.entries(leaves)) {
    const segs = path.split(".");
    let node = root;
    for (const seg of segs.slice(0, -1)) node = (node[seg] ??= {}) as Record<string, unknown>;
    node[segs[segs.length - 1]!] = { $value: value, ...(ext[path] ? { $extensions: ext[path] } : {}) };
  }
  return root;
}

/** Semantic role set from `"group.name" → $value` (two-segment role paths). */
function roleSet(roles: Record<string, string>): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(roles)) {
    const [group, name] = path.split(".") as [string, string];
    const g = (root[group] ??= { $type: "color" }) as Record<string, unknown>;
    g[name] = { $value: value };
  }
  return root;
}

const DERIVED = { "ai.objectcore.derived": { source: true } };
const DERIVED_NOTE = { "ai.objectcore.derived": { source: "poc verbatim" } };

/** A hand-built WIDE-contract system: 3 themes, half-step ramps, `$extensions`
 *  provenance, a shared solid set, one deliberately failing pair (dusk text.muted). */
const WIDE: DesignSystemSource = {
  sets: {
    primitives: {
      color: {
        $type: "color",
        mist: colorGroup(
          { "50": "#fbfbfa", "100": "#f2f2ef", "150": "#e9e9e4", "500": "#8a8a82", "850": "#2e2d2a", "900": "#1c1b19", "950": "#0e0e0d" },
          { "50": DERIVED, "950": DERIVED },
        ),
        flame: colorGroup({ "100": "#fde8e0", "800": "#7c2d12" }, { "800": DERIVED_NOTE }),
      },
    },
    shared: roleSet({
      "solid.success": "#0a5c33", "solid.on-success": "#f2fbf5",
      "solid.warning": "#7a5a08", "solid.on-warning": "#fffbe8",
      "solid.danger": "#8c1d18", "solid.on-danger": "#fff0ee",
    }),
    "semantic-day": roleSet({
      "bg.base": "{color.mist.50}", "bg.surface": "{color.mist.100}", "bg.raised": "{color.mist.150}",
      "border.subtle": "#dcdcd6", "border.strong": "#8a8a82", "border.input": "#6a6a63",
      "text.emphasis": "{color.mist.950}", "text.primary": "#1c1b19", "text.secondary": "#2e2d2a",
      "text.muted": "#3f3e3a", "text.disabled": "#9a9a92",
      "accent.default": "{color.flame.800}", "accent.hover": "#5c210d", "accent.subtle-bg": "#fde8e0",
      "accent.on-accent": "#fbfbfa", "accent.focus-ring": "#7c2d12",
      "status.success-bg": "#e3f2e7", "status.success-text": "#0b3d22",
      "status.warning-bg": "#fbf0d9", "status.warning-text": "#4d3805",
      "status.danger-bg": "#fde8e0", "status.danger-text": "#7c2d12",
      "chart.grid": "#8a8a82",
    }),
    "semantic-dusk": roleSet({
      "bg.base": "{color.mist.900}", "bg.surface": "{color.mist.850}", "bg.raised": "#3a3934",
      "border.subtle": "#3a3934", "border.strong": "#6a6a63", "border.input": "#8a8a82",
      "text.emphasis": "#f2f2ef", "text.primary": "{color.mist.150}", "text.secondary": "#d6d6d0",
      "text.muted": "#4a4a45", "text.disabled": "#6a6a63", // muted deliberately FAILS on dark bgs
      "accent.default": "#f0a284", "accent.hover": "#f6c3ae", "accent.subtle-bg": "#4a1c0c",
      "accent.on-accent": "#1c1b19", "accent.focus-ring": "#f0a284",
      "status.success-bg": "#123324", "status.success-text": "#9fe0bb",
      "status.warning-bg": "#33290d", "status.warning-text": "#ecd28a",
      "status.danger-bg": "#3d130f", "status.danger-text": "#f5b3a1",
    }),
    "semantic-void": roleSet({
      "bg.base": "{color.mist.950}", "bg.surface": "{color.mist.900}", "bg.raised": "{color.mist.850}",
      "border.subtle": "#34332f", "border.strong": "#6a6a63", "border.input": "#8a8a82",
      "text.emphasis": "#f6f6f3", "text.primary": "#eeeee9", "text.secondary": "#d9d9d3",
      "text.muted": "#bcbcb5", "text.disabled": "#7a7a73",
      "accent.default": "#f2b09a", "accent.hover": "#f8cdbd", "accent.subtle-bg": "#4a1c0c",
      "accent.on-accent": "#0e0e0d", "accent.focus-ring": "#f2b09a",
      "status.success-bg": "#123324", "status.success-text": "#9fe0bb",
      "status.warning-bg": "#33290d", "status.warning-text": "#ecd28a",
      "status.danger-bg": "#3d130f", "status.danger-text": "#f5b3a1",
    }),
  },
  resolver: {
    resolutionOrder: ["primitives", "shared", "theme"],
    modifiers: [{ name: "theme", contexts: { day: ["semantic-day"], dusk: ["semantic-dusk"], void: ["semantic-void"] } }],
  },
  themes: [
    { name: "day", context: { theme: "day" } },
    { name: "dusk", context: { theme: "dusk" } },
    { name: "void", context: { theme: "void" } },
  ],
};

const wideOut = deriveDesignSystem(WIDE);
const wideProof = proveContrast(wideOut, { level: "AA" });
const wideInput: SpecInput = {
  system: "widetest",
  output: wideOut,
  proof: wideProof,
  provenance: specProvenance(WIDE),
  copy: {
    tagline: "A test system, measured.",
    principles: [{ title: "One wire", body: "The accent is the only interactive voice." }],
    rampNotes: { mist: "the chassis" },
    roleNotes: { "accent.default": "Links, primary actions, selection." },
  },
};
const wideHtml = renderSpecHtml(wideInput);

/** A hand-built NARROW legacy-vocabulary system (bg.canvas/subtle/surface …), 2 themes —
 *  the widened scaffold no longer emits this contract (clean break), so the un-migrated
 *  shape is pinned by hand. */
const NARROW: DesignSystemSource = {
  sets: {
    primitives: {
      color: {
        $type: "color",
        neutral: {
          // 12 steps so numeric (not lexical) step ordering keeps a real fixture.
          light: colorGroup({
            "1": "#ffffff", "2": "#fafafa", "3": "#f2f2f2", "4": "#e8e8e8",
            "5": "#dedede", "6": "#d2d2d2", "7": "#c0c0c0", "8": "#a8a8a8",
            "9": "#8a8a8a", "10": "#6a6a6a", "11": "#4a4a4a", "12": "#161616",
          }),
          dark: colorGroup({ "1": "#111013" }),
        },
      },
    },
    "semantic-light": roleSet({
      "bg.canvas": "{color.neutral.light.1}", "bg.subtle": "#f4f4f2", "bg.surface": "#ececea",
      "text.primary": "#16150f", "text.subtle": "#3f3e38",
      "border.default": "#d9d9d6",
      "accent.solid": "#7c2d12", "accent.text": "#7c2d12",
    }),
    "semantic-dark": roleSet({
      "bg.canvas": "{color.neutral.dark.1}", "bg.subtle": "#1b1a1e", "bg.surface": "#262529",
      "text.primary": "#f0efe9", "text.subtle": "#c9c8c2",
      "border.default": "#3a393e",
      "accent.solid": "#f0a284", "accent.text": "#f0a284",
    }),
  },
  resolver: {
    resolutionOrder: ["primitives", "theme"],
    modifiers: [{ name: "theme", contexts: { light: ["semantic-light"], dark: ["semantic-dark"] } }],
  },
  themes: [
    { name: "light", context: { theme: "light" } },
    { name: "dark", context: { theme: "dark" } },
  ],
};
const narrowOut = deriveDesignSystem(NARROW);
const narrowProof = proveContrast(narrowOut, { level: "AA", includeLegacy: true });
const narrowInput: SpecInput = {
  system: "narrowtest",
  output: narrowOut,
  proof: narrowProof,
  provenance: specProvenance(NARROW),
  brief: { name: "narrowtest", adjectives: ["calm", "minimal"] },
};
const narrowHtml = renderSpecHtml(narrowInput);

const tbodyOf = (html: string): string => html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));
const count = (html: string, re: RegExp): number => (html.match(re) ?? []).length;

test("the wide fixture derives cleanly (the fixture itself must not be the failure)", () => {
  expect(wideOut.issues.filter((i) => i.level === "error")).toEqual([]);
  expect(wideOut.themes.map((t) => t.name)).toEqual(["day", "dusk", "void"]);
  expect(wideProof.some((e) => e.theme === "dusk" && e.fgPath === "text.muted" && !e.pass && !e.exempt)).toBe(true);
});

// ── Skeleton + per-theme wiring ───────────────────────────────────────────────

test("renderSpecHtml emits a complete document with every section", () => {
  expect(wideHtml.startsWith("<!DOCTYPE html>")).toBe(true);
  expect(wideHtml.trimEnd().endsWith("</html>")).toBe(true);
  for (const id of ["principles", "ramps", "roles", "parity", "rooms", "proof", "adoption"]) {
    expect(wideHtml).toContain(`<section id="${id}">`);
  }
  expect(wideHtml).toContain('<header class="hero">');
  expect(wideHtml).toContain('class="colophon"');
  expect(wideHtml).toContain('id="toast"');
});

test("a [data-theme] CSS block AND a switcher button exist for every theme (plus :root)", () => {
  expect(wideHtml).toContain(":root {");
  for (const name of ["day", "dusk", "void"]) {
    expect(wideHtml).toContain(`[data-theme="${name}"] {`);
    expect(wideHtml).toContain(`<button class="mode" type="button" data-set-theme="${name}">`);
  }
});

// ── Ramps ─────────────────────────────────────────────────────────────────────

test("the ramps section renders one band per family with click-to-copy and provenance dots", () => {
  expect(wideHtml).toContain('data-ramp="mist"');
  expect(wideHtml).toContain('data-ramp="flame"');
  expect(wideHtml).toContain('data-copy="#7c2d12"');
  // 3 steps carry $extensions provenance in the fixture (mist.50, mist.950, flame.800).
  expect(count(wideHtml, /class="dot"/g)).toBe(3);
  expect(wideHtml).toContain("poc verbatim"); // the string-valued source note rides the dot title
  expect(wideHtml).toContain("the chassis"); // rampNotes copy lands in the ramp meta
});

test("extractRamps groups color.* by family and sorts steps numerically (half-steps included)", () => {
  const ramps = extractRamps(wideOut.themes[0]!);
  expect(ramps.map((r) => r.family)).toEqual(["flame", "mist"]); // first appearance in path-sorted tokens
  expect(ramps[1]!.steps.map((s) => s.step)).toEqual(["50", "100", "150", "500", "850", "900", "950"]);
  expect(ramps[0]!.steps.find((s) => s.step === "800")!.source).toBe("poc verbatim");
  // 12-step ramps sort 1..12 numerically, never lexically (1, 10, 11, 12, 2…).
  const narrowRamps = extractRamps(narrowOut.themes[0]!);
  const neutral = narrowRamps.find((r) => r.family === "neutral.light")!;
  expect(neutral.steps.map((s) => s.step)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]);
});

// ── Roles ─────────────────────────────────────────────────────────────────────

test("extractRoles groups non-ramp color tokens in canonical contract order", () => {
  const groups = extractRoles(wideOut.themes[0]!);
  expect(groups.map((g) => g.group)).toEqual(["bg", "text", "border", "accent", "status", "solid", "chart"]);
  expect(groups.every((g) => g.roles.every((r) => !r.path.startsWith("color.")))).toBe(true);
  // Narrow scaffold: no font/space/motion leak (non-color types are not roles).
  const narrowGroups = extractRoles(narrowOut.themes[0]!);
  expect(narrowGroups.map((g) => g.group)).toEqual(["bg", "text", "border", "accent"]);
});

test("a role missing from one theme renders an empty dashed cell, not a crash or undefined", () => {
  // chart.grid exists only in day; dusk/void cells must degrade.
  expect(count(wideHtml, /class="spec none"/g)).toBe(2);
  expect(wideHtml).toContain("chart.grid — not defined in dusk");
});

// ── Provenance ────────────────────────────────────────────────────────────────

test("specProvenance maps each aliased role to its referenced primitive, per theme", () => {
  const prov = specProvenance(WIDE);
  expect(Object.keys(prov)).toEqual(["day", "dusk", "void"]);
  expect(prov.day!["bg.base"]).toBe("color.mist.50");
  expect(prov.day!["accent.default"]).toBe("color.flame.800");
  expect(prov.day!["border.subtle"]).toBeUndefined(); // raw hex — no reference, no provenance
  expect(prov.dusk!["bg.base"]).toBe("color.mist.900");
  // Hand-built narrow system: same mechanism, legacy vocabulary.
  const narrowProv = specProvenance(NARROW);
  expect(narrowProv.light!["bg.canvas"]).toBe("color.neutral.light.1");
  // No resolver → the single merged "default" theme.
  const flat = specProvenance({ sets: { base: roleSet({ "bg.canvas": "#ffffff" }) } });
  expect(Object.keys(flat)).toEqual(["default"]);
});

// ── Proof table ───────────────────────────────────────────────────────────────

test("the proof table renders one <tr> per entry with 2-decimal ratios, floors, and badges", () => {
  const tbody = tbodyOf(wideHtml);
  expect(count(tbody, /<tr>/g)).toBe(wideProof.length);
  const passing = wideProof.find((e) => e.pass && e.kind === "text" && !e.exempt)!;
  expect(tbody).toContain(`${passing.ratio!.toFixed(2)}:1`);
  expect(tbody).toContain("≥ 4.5:1");
  expect(tbody).toContain("≥ 3:1");
  expect(count(tbody, />FAIL</g)).toBe(wideProof.filter((e) => !e.pass && !e.exempt).length);
  expect(count(tbody, />EXEMPT</g)).toBe(wideProof.filter((e) => e.exempt).length);
  expect(count(tbody, />AA</g)).toBeGreaterThan(0); // passing text pairs badge their level
  expect(count(tbody, />PASS</g)).toBeGreaterThan(0); // passing non-text pairs
  expect(wideHtml).toContain("text pairs gate at AA"); // the target level is stated
});

test("the proof section is omitted entirely when no proof is injected", () => {
  const html = renderSpecHtml({ system: "widetest", output: wideOut });
  expect(html).not.toContain('<section id="proof">');
});

// ── Leaks, data island, wiring ────────────────────────────────────────────────

test("no NaN/undefined/[object Object] leaks into either page", () => {
  for (const html of [wideHtml, narrowHtml]) {
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("[object Object]");
  }
});

test("the embedded SPEC JSON parses and matches the rendered counts", () => {
  const match = wideHtml.match(/const SPEC = (.*);/);
  expect(match).not.toBeNull();
  const spec = JSON.parse(match![1]!);
  expect(spec.system).toBe("widetest");
  expect(spec.themes).toEqual(["day", "dusk", "void"]);
  expect(spec.ramps).toEqual([
    { family: "flame", steps: 2 },
    { family: "mist", steps: 7 },
  ]);
  expect(spec.proof).toEqual({
    entries: wideProof.length,
    pass: wideProof.filter((e) => e.pass && !e.exempt).length,
    fail: wideProof.filter((e) => !e.pass && !e.exempt).length,
    exempt: wideProof.filter((e) => e.exempt).length,
  });
});

test("clipboard + dataset.theme wiring is present in the page script", () => {
  expect(wideHtml).toContain("navigator.clipboard");
  expect(wideHtml).toContain("root.dataset.theme = name");
});

test("two renders are byte-identical (no timestamps, no randomness)", () => {
  expect(renderSpecHtml(wideInput)).toBe(wideHtml);
  expect(renderSpecHtml(narrowInput)).toBe(narrowHtml);
});

// ── Escaping ──────────────────────────────────────────────────────────────────

test("hostile prose and system names cannot break out of the page", () => {
  const evil = "</script><script>alert(1)</script>";
  const html = renderSpecHtml({
    system: `sys${evil}`,
    output: wideOut,
    copy: { title: evil, tagline: `He said <b>"hi"</b> & 'bye'`, principles: [{ title: evil, body: "x & <y>" }] },
  });
  expect(html).not.toContain("<script>alert");
  expect(html.split("</script>").length).toBe(2); // exactly the page's own script close tag
  expect(html).toContain("&lt;/script&gt;"); // the prose survives, escaped
  expect(html).toContain("\\u003c"); // and the SPEC data island escapes `<`
});

test("a theme name with a quote is CSS-escaped in the selector and HTML-escaped in attributes", () => {
  const out: DesignSystemOutput = {
    issues: [],
    themes: [
      { name: 'ev"il', context: {}, tokens: [{ path: "bg.base", type: "color", value: "#ffffff" }, { path: "text.primary", type: "color", value: "#111111" }] },
    ],
  };
  const html = renderSpecHtml({ system: "esc", output: out });
  expect(html).toContain('[data-theme="ev\\"il"] {');
  expect(html).toContain('data-set-theme="ev&quot;il"');
});

// ── Sink contract ─────────────────────────────────────────────────────────────

test("SpecHtmlSink emits [{path:'spec.html'}] whose content is exactly renderSpecHtml", () => {
  const meta = { system: "widetest", proof: wideProof, provenance: specProvenance(WIDE) };
  const files = new SpecHtmlSink(meta).emit(wideOut);
  expect(files.map((f) => f.path)).toEqual(["spec.html"]);
  expect(files[0]!.content).toBe(renderSpecHtml({ ...meta, output: wideOut }));
  expect(new SpecHtmlSink(meta, "index.html").emit(wideOut)[0]!.path).toBe("index.html");
});

// ── Graceful degradation ──────────────────────────────────────────────────────

test("a narrow legacy-contract system renders through the fallback chrome", () => {
  expect(narrowHtml).not.toContain('<section id="principles">'); // no copy → no principles
  expect(narrowHtml).toContain("var(--bg-base, var(--bg-canvas"); // the chrome fallback chain
  expect(count(narrowHtml, /class="pane" data-theme=/g)).toBe(2);
  expect(count(narrowHtml, /class="room"/g)).toBe(2);
  expect(tbodyOf(narrowHtml)).toContain("text.primary on bg.canvas"); // legacy pairs prove too
  expect(count(tbodyOf(narrowHtml), /<tr>/g)).toBe(narrowProof.length);
});

test("a single-theme (resolver-less) system renders one pane and one room", () => {
  const single = deriveDesignSystem({
    sets: {
      base: {
        ...roleSet({ "bg.canvas": "#ffffff", "bg.surface": "#f2f2f2", "text.primary": "#111111", "accent.text": "#0000aa" }),
        color: { $type: "color", ink: colorGroup({ "1": "#ffffff", "2": "#111111" }) },
      },
    },
  });
  const proof = proveContrast(single, { level: "AA", includeLegacy: true });
  const html = renderSpecHtml({ system: "solo", output: single, proof });
  expect(single.themes.map((t) => t.name)).toEqual(["default"]);
  expect(html).toContain('[data-theme="default"] {');
  expect(count(html, /class="pane" data-theme=/g)).toBe(1);
  expect(count(html, /class="room"/g)).toBe(1);
  expect(html).toContain("One system, 1 room.");
});
