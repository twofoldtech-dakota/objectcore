// `bun run design:scaffold <brief.json> [--out <dir>] [--force]` — the deterministic
// half of /design. Takes a ScaffoldSpec (produced by the grill + plan phases), expands
// it into a complete accessible-by-construction DTCG token SSOT, writes the source
// (`*.tokens.json` + `resolver.json` + `evals/design.json`), then derives the consumable
// views (`dist/tokens.css`, `dist/<theme>.tokens.json`) and prints the self-gate. The
// judged eval (`runDesignEval`, needs a key) is the explicit next step.

import { join, relative } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import {
  scaffoldDesignSystem,
  deriveDesignSystem,
  CssVarSink,
  JsonSink,
  type ScaffoldSpec,
} from "@objectcore/design";

const specPath = process.argv[2];
if (!specPath || specPath.startsWith("--")) {
  console.error("usage: bun run design:scaffold <brief.json> [--out <dir>] [--force]");
  process.exit(2);
}
const force = process.argv.includes("--force");
const outFlag = process.argv.indexOf("--out");
const root = join(import.meta.dir, "..");

const spec = JSON.parse(readFileSync(specPath, "utf8")) as ScaffoldSpec;
const outDir = outFlag !== -1 && process.argv[outFlag + 1]
  ? join(root, process.argv[outFlag + 1]!)
  : join(root, "design", spec.brief.name);

if (existsSync(outDir) && readdirSync(outDir).length > 0 && !force) {
  console.error(`✗ ${relative(root, outDir)} is not empty — pass --force to overwrite`);
  process.exit(2);
}

const { source, evalSpec, issues } = scaffoldDesignSystem(spec);

const rel = (p: string) => relative(root, p);
const write = (p: string, content: string) => {
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, content);
  console.log(`    + ${rel(p)}`);
};

console.log(`✓ scaffolded design system "${spec.brief.name}" -> ${rel(outDir)}`);
for (const [name, set] of Object.entries(source.sets)) {
  write(join(outDir, `${name}.tokens.json`), JSON.stringify(set, null, 2) + "\n");
}
write(
  join(outDir, "resolver.json"),
  JSON.stringify({ ...source.resolver, themes: source.themes }, null, 2) + "\n",
);
write(join(outDir, "evals", "design.json"), JSON.stringify(evalSpec, null, 2) + "\n");

// Derive the consumable views (the bridge to a real site).
const out = deriveDesignSystem(source);
for (const f of new CssVarSink().emit(out)) write(join(outDir, "dist", f.path), f.content);
for (const f of new JsonSink().emit(out)) write(join(outDir, "dist", f.path), f.content);

const errors = issues.filter((i) => i.level === "error");
const warnings = issues.filter((i) => i.level === "warning");
for (const w of warnings) console.log(`  ! ${w.token ? `${w.token}: ` : ""}${w.message}`);
for (const e of errors) console.error(`  ✗ ${e.token ? `${e.token}: ` : ""}${e.message}`);
console.log(
  errors.length
    ? `\n✗ self-gate FAILED (${errors.length} error(s))`
    : `\n✓ self-gate passed (valid + accessible by construction)${warnings.length ? `, ${warnings.length} warning(s)` : ""}`,
);
console.log("Next: `runDesignEval` (the judged on-brand gate, needs an API key).");
if (errors.length) process.exit(1);
