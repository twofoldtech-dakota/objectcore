// `bun run design:build [<system>]` — derive the consumable VIEWS (`dist/tokens.css`,
// per-theme JSON, Tailwind, Style Dictionary, `contrast-proof.json`, `spec.html`) from
// a committed design SSOT under `design/*/`. Unlike `design:scaffold` (which regenerates
// the whole SSOT from a brief and would clobber hand-refinements), this reads the
// source-of-truth `*.tokens.json` + `resolver.json` AS-IS and only writes the derived
// `dist/` views — the source→view step the marketing site runs. The proof artifact and
// the spec page's proof table ride the SAME gate math `design:check` runs (the level
// the system's `system.json` manifest declares, legacy pairs included) — measured, not
// promised. `dist/` is a build artifact (gitignored). Exits non-zero if a system has
// resolution errors.

import { join, relative } from "node:path";
import { readdirSync, statSync, existsSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import {
  FileTokenSource,
  loadSystemManifest,
  deriveDesignSystem,
  proveContrast,
  specProvenance,
  CssVarSink,
  JsonSink,
  TailwindThemeSink,
  StyleDictionarySink,
  ProofSink,
  SpecHtmlSink,
  type SpecCopy,
  type DesignBrief,
} from "@objectcore/design";

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

/** Optional per-system JSON (`brief.json` / `spec-copy.json`): absent → undefined,
 *  malformed → loud failure with the path. */
function readOptionalJson(path: string): unknown {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`${path}: ${(e as Error).message}`);
  }
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
  const manifest = await loadSystemManifest(dir); // absent → AA/presence; malformed → loud
  const out = deriveDesignSystem(source);
  const errs = out.issues.filter((i) => i.level === "error");
  if (errs.length) {
    errors += errs.length;
    console.error(`✗ ${name}: ${errs.length} resolution error(s) — run \`bun run design:check\``);
    continue;
  }
  const proofOpts = { level: manifest.gate.level, includeLegacy: true };
  const copy = readOptionalJson(join(dir, "spec-copy.json")) as SpecCopy | undefined;
  // brief.json is the scaffold spec; its `brief` field is the judge-facing DesignBrief.
  const scaffoldSpec = readOptionalJson(join(dir, "brief.json")) as { brief?: DesignBrief } | undefined;

  const distDir = join(dir, "dist");
  mkdirSync(distDir, { recursive: true });
  const files = [
    ...new CssVarSink().emit(out),
    ...new JsonSink().emit(out),
    ...new TailwindThemeSink().emit(out),
    ...new StyleDictionarySink().emit(out),
    ...new ProofSink(proofOpts).emit(out),
    ...new SpecHtmlSink({
      system: name,
      proof: proveContrast(out, proofOpts),
      provenance: specProvenance(source),
      copy,
      brief: scaffoldSpec?.brief,
    }).emit(out),
  ];
  for (const f of files) writeFileSync(join(distDir, f.path), f.content);
  console.log(`✓ ${name} → ${relative(root, distDir)} (${files.length} file(s), ${out.themes.length} theme(s))`);
}

if (errors) process.exit(1);
