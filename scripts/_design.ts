// Shared post-scaffold tail for the design CLIs (design-scaffold, design-seed) —
// the design analogue of `scripts/_finalize.ts`: guard the target dir (--force),
// write the SSOT (sets + resolver + system.json + evals/design.json), derive the
// consumable views (dist/tokens.css, per-theme JSON), and print the self-gate.
// Not runnable (underscore prefix); the CLIs own argv parsing and process.exit.

import { join, relative } from "node:path";
import { writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { deriveDesignSystem, CssVarSink, JsonSink, type ScaffoldResult } from "@objectcore/design";

export interface WriteSystemOptions {
  /** Allow overwriting a non-empty target dir. */
  force: boolean;
  /** The CLI's success line, printed once the --force guard passes. */
  headline: string;
}

/** Write a ScaffoldResult to `outDir` and self-gate it. Returns the process exit
 *  code: 0 ok, 1 self-gate red (files are still written — the errors ARE the
 *  output), 2 guard refusal (nothing written). */
export function writeSystemAndGate(root: string, outDir: string, result: ScaffoldResult, opts: WriteSystemOptions): number {
  if (existsSync(outDir) && readdirSync(outDir).length > 0 && !opts.force) {
    console.error(`✗ ${relative(root, outDir)} is not empty — pass --force to overwrite`);
    return 2;
  }
  const { source, evalSpec, manifest, issues } = result;

  const rel = (p: string) => relative(root, p);
  const write = (p: string, content: string) => {
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
    console.log(`    + ${rel(p)}`);
  };

  console.log(opts.headline);
  for (const [name, set] of Object.entries(source.sets)) {
    write(join(outDir, `${name}.tokens.json`), JSON.stringify(set, null, 2) + "\n");
  }
  write(
    join(outDir, "resolver.json"),
    JSON.stringify({ ...source.resolver, themes: source.themes }, null, 2) + "\n",
  );
  if (manifest) write(join(outDir, "system.json"), JSON.stringify(manifest, null, 2) + "\n");
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
  return errors.length ? 1 : 0;
}
