// `bun run design:build [<system>]` — derive the consumable VIEWS (`dist/tokens.css`,
// per-theme JSON) from a committed design SSOT under `design/*/`. Unlike `design:scaffold`
// (which regenerates the whole SSOT from a brief and would clobber hand-refinements),
// this reads the source-of-truth `*.tokens.json` + `resolver.json` AS-IS and only writes
// the derived `dist/` views — the source→view step the marketing site runs. `dist/` is a
// build artifact (gitignored). Exits non-zero if a system has resolution errors.

import { join, relative } from "node:path";
import { readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { FileTokenSource, deriveDesignSystem, CssVarSink, JsonSink, TailwindThemeSink, StyleDictionarySink } from "@objectcore/design";

const root = join(import.meta.dir, "..");
const designDir = join(root, "design");
const only = process.argv[2];

function listSystems(): string[] {
  if (!existsSync(designDir)) return [];
  return readdirSync(designDir)
    .filter((n) => !only || n === only)
    .map((n) => join(designDir, n))
    .filter((p) => statSync(p).isDirectory() && readdirSync(p).some((f) => f.endsWith(".tokens.json")));
}

const systems = listSystems();
if (systems.length === 0) {
  console.log(only ? `design:build — no system "${only}" under design/.` : "design:build — no design systems under design/*/.");
  process.exit(0);
}

let errors = 0;
for (const dir of systems) {
  const name = relative(designDir, dir);
  const source = await new FileTokenSource(dir).load();
  const out = deriveDesignSystem(source);
  const errs = out.issues.filter((i) => i.level === "error");
  if (errs.length) {
    errors += errs.length;
    console.error(`✗ ${name}: ${errs.length} resolution error(s) — run \`bun run design:check\``);
    continue;
  }
  const distDir = join(dir, "dist");
  mkdirSync(distDir, { recursive: true });
  const files = [
    ...new CssVarSink().emit(out),
    ...new JsonSink().emit(out),
    ...new TailwindThemeSink().emit(out),
    ...new StyleDictionarySink().emit(out),
  ];
  for (const f of files) writeFileSync(join(distDir, f.path), f.content);
  console.log(`✓ ${name} → ${relative(root, distDir)} (${files.length} file(s), ${out.themes.length} theme(s))`);
}

if (errors) process.exit(1);
