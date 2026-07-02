// `bun run design:seed --list` |
// `bun run design:seed <preset> [--name <s>] [--themes a,b,c] [--out <dir>] [--force]`
// — the quick-start half of /design (plan 014). Picks a curated preset (inkwell,
// cathode), optionally a theme subset, and expands it via `instantiatePreset` into
// an instant gate-passing system, then hands off to the SAME shared tail as
// design:scaffold (`scripts/_design.ts`). `--list` renders the inventory from
// `listPresets()` — never hardcoded here, so a new preset ships its own listing.
// Exits 0 ok / 1 self-gate red / 2 usage (unknown preset/theme, non-empty dir).

import { join, relative, resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { listPresets, getPreset, instantiatePreset } from "@objectcore/design";
import { writeSystemAndGate } from "./_design";

const USAGE =
  "usage: bun run design:seed --list\n" +
  "       bun run design:seed <preset> [--name <s>] [--themes a,b,c] [--out <dir>] [--force]";

const argv = process.argv.slice(2);
const root = join(import.meta.dir, "..");

if (argv.length === 0) {
  console.error(USAGE);
  process.exit(2);
}

if (argv.includes("--list")) {
  for (const p of listPresets()) {
    console.log(`\n${p.name} v${p.version} (${p.level})`);
    console.log(`  ${p.description}`);
    for (const t of p.themes) {
      const mark = t.default ? "*" : " ";
      console.log(`  ${mark} ${t.name.padEnd(10)} ${t.appearance.padEnd(5)} — ${t.description ?? ""}`);
    }
  }
  console.log("\n(* = the appearance's default; the first * theme is the seeded :root)");
  process.exit(0);
}

const presetName = argv[0]!;
if (presetName.startsWith("--")) {
  console.error(USAGE);
  process.exit(2);
}
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
};
const force = argv.includes("--force");
const nameFlag = flag("--name");
const themesFlag = flag("--themes");
const outFlag = flag("--out");

// Unknown preset/theme is a USAGE error (exit 2): print the valid options.
const preset = getPreset(presetName);
if (!preset) {
  console.error(`✗ unknown preset \`${presetName}\` — valid presets: ${listPresets().map((p) => p.name).join(", ")}`);
  process.exit(2);
}
const themes = themesFlag?.split(",").map((t) => t.trim()).filter(Boolean);
const known = new Set(preset.themes.map((t) => t.name));
for (const t of themes ?? []) {
  if (!known.has(t)) {
    console.error(`✗ preset \`${preset.name}\` has no theme \`${t}\` — valid themes: ${preset.themes.map((x) => x.name).join(", ")}`);
    process.exit(2);
  }
}
if (themes && themes.length === 0) {
  console.error(`✗ --themes needs at least one of: ${preset.themes.map((x) => x.name).join(", ")}`);
  process.exit(2);
}

const name = nameFlag ?? preset.name;
// `resolve` (not `join`): --out may be an absolute path outside the repo.
const outDir = outFlag ? resolve(root, outFlag) : join(root, "design", name);

const result = instantiatePreset(preset.name, { name, themes });
const code = writeSystemAndGate(root, outDir, result, {
  force,
  headline: `✓ seeded design system "${name}" from preset ${preset.name} v${preset.version} -> ${relative(root, outDir)}`,
});
if (code === 2) process.exit(2);

// The preset's editorial voice rides along so the generated spec page can use it.
if (preset.specCopy) {
  const copyPath = join(outDir, "spec-copy.json");
  writeFileSync(copyPath, JSON.stringify(preset.specCopy, null, 2) + "\n");
  console.log(`    + ${relative(root, copyPath)}`);
}
console.log("Next: `bun run design:build` derives the views; `bun run design:check` re-gates it.");
if (code) process.exit(code);
