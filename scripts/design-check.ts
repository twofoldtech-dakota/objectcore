// `bun run design:check` — read-only gate over any committed design systems under
// `design/*/`. The design-token analogue of `check:catalog`: it loads each system
// (a FileTokenSource over `*.tokens.json` + `resolver.json`), runs the DTCG schema
// floor, derives every theme, and runs the deterministic contrast gate on the standard
// semantic pairs that resolve. The judged on-brand layer runs only with an API key
// (skipped otherwise — never silently passed), exactly like the activation eval. It is
// a CLEAN NO-OP until an SSOT is committed (P6), so it is safe to wire into `bun run
// check` now. Exits non-zero on any deterministic error.

import { join, relative } from "node:path";
import { readdirSync, statSync, existsSync } from "node:fs";
import {
  FileTokenSource,
  deriveDesignSystem,
  validateTokens,
  checkContrast,
  loadDesignEvalSpec,
  runDesignEval,
  summarizeSystem,
  AnthropicDesignJudge,
  hasApiKey,
  type ContrastPair,
  type TokenIssue,
} from "@objectcore/design";

const root = join(import.meta.dir, "..");
const designDir = join(root, "design");

// The standard semantic pairs the deterministic gate checks when present. TEXT only:
// text always needs contrast (WCAG 1.4.3/1.4.6). We deliberately do NOT gate subtle
// borders/separators — WCAG 1.4.11's 3:1 non-text floor applies to *meaningful* UI
// boundaries and focus indicators, NOT decorative separators (a step-6/7 hairline),
// so requiring it there is a false failure. A system that wants a 3:1 focus ring should
// add an explicit focus token + opt into a pair; the universal floor is text.
// Text is gated on EVERY canvas-class bg the semantic set aliases (bg.canvas,
// bg.subtle, bg.surface) — text that only holds on step 1 fails on a card.
const STD_TEXT: Array<{ fgPath: string; level: "AA" | "AAA" }> = [
  { fgPath: "text.primary", level: "AAA" },
  { fgPath: "text.subtle", level: "AA" },
  { fgPath: "accent.text", level: "AA" },
];
const STD_BGS = ["bg.canvas", "bg.subtle", "bg.surface"];
const STD_PAIRS: Array<Omit<ContrastPair, "fg" | "bg"> & { fgPath: string; bgPath: string }> = STD_BGS.flatMap(
  (bgPath) => STD_TEXT.map(({ fgPath, level }) => ({ label: `${fgPath} on ${bgPath}`, fgPath, bgPath, level })),
);

function listSystems(): string[] {
  if (!existsSync(designDir)) return [];
  return readdirSync(designDir)
    .map((n) => join(designDir, n))
    .filter((p) => statSync(p).isDirectory() && readdirSync(p).some((f) => f.endsWith(".tokens.json")));
}

const systems = listSystems();
if (systems.length === 0) {
  console.log("design:check — no design systems under design/*/ (nothing to check).");
  process.exit(0);
}

let errors = 0;
let warnings = 0;
const note = (msg: string) => console.log(`  • ${msg}`);
const report = (issues: TokenIssue[], prefix: string) => {
  for (const i of issues) {
    if (i.level === "error") { errors++; console.error(`  ✗ ${prefix}${i.token ? `${i.token}: ` : ""}${i.message}`); }
    else { warnings++; console.log(`  ! ${prefix}${i.token ? `${i.token}: ` : ""}${i.message}`); }
  }
};

for (const dir of systems) {
  const name = relative(designDir, dir);
  console.log(`\n▸ ${name}`);
  const source = await new FileTokenSource(dir).load();

  for (const [setName, set] of Object.entries(source.sets)) {
    report(validateTokens(set), `[${setName}] `);
  }

  const out = deriveDesignSystem(source);
  report(out.issues, "");

  let checkedPairs = 0;
  for (const theme of out.themes) {
    const get = (p: string) => theme.tokens.find((t) => t.path === p)?.value;
    const pairs: ContrastPair[] = [];
    for (const s of STD_PAIRS) {
      const fg = get(s.fgPath);
      const bg = get(s.bgPath);
      if (fg === undefined || bg === undefined) continue; // not a missing-token error; not all systems use the standard names
      pairs.push({ label: `${theme.name}: ${s.label}`, fg, bg, level: s.level, nonText: s.nonText });
    }
    checkedPairs += pairs.length;
    report(checkContrast(pairs), "");
  }
  note(`${out.themes.length} theme(s), ${checkedPairs} standard contrast pair(s) checked`);

  // Judged on-brand layer — key-gated, never silently passed.
  const spec = await loadDesignEvalSpec(dir);
  if (!spec) {
    note("no evals/design.json — judged on-brand layer not specified");
  } else if (!hasApiKey()) {
    note(`[skipped] judged eval (${spec.cases.length} case(s)) — no ANTHROPIC_API_KEY`);
  } else {
    const results = await runDesignEval(spec, summarizeSystem(name, out), new AnthropicDesignJudge());
    for (const r of results) {
      if (!r.passed) { errors++; console.error(`  ✗ judge ${r.name}: ${r.detail}`); }
      else console.log(`  ✓ judge ${r.name}: ${r.detail}`);
    }
  }
}

console.log(
  errors
    ? `\n✗ design:check FAILED — ${errors} error(s), ${warnings} warning(s) across ${systems.length} system(s)`
    : `\n✓ design:check passed — ${systems.length} system(s), ${warnings} warning(s)`,
);
if (errors) process.exit(1);
