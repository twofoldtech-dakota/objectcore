// The deterministic scaffolder: PluginSpec -> files on disk. It guards the hard
// rules at generation time (kebab-case names, components at the plugin ROOT, a
// string `repository`, an array `keywords`) and enforces the factory rule that a
// skill must ship an activation eval. It never overwrites an existing plugin dir
// without `force`. After scaffolding, the catalog is re-derived and the gate run
// by scripts/forge-scaffold.ts — this module only emits.

import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ComponentSpec, PluginSpec, ScaffoldResult } from "./types";

// Canonical rule lives in registry-core/validate.ts; mirrored here for a fast
// pre-write guard so we never emit a plugin the catalog would later reject.
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const json = (v: unknown): string => JSON.stringify(v, null, 2) + "\n";

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function emit(written: string[], path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  written.push(path);
}

function titleCase(name: string): string {
  return name.replace(/(^|-)([a-z0-9])/g, (_, sep, ch) => (sep ? " " : "") + ch.toUpperCase()).trim();
}

/** Sentinel marking an unfilled scaffolded skill body. Plan 006's eval fails any
 *  shipped skill whose body still contains it. Kept as a plain string (no cross-package
 *  import) — eval scans for this literal. */
export const FORGE_STUB_MARKER = "<!-- forge:todo -->";

function defaultSkillBody(s: ComponentSpec): string {
  return `# ${titleCase(s.name)}

${FORGE_STUB_MARKER} Replace this stub with the real skill instructions — what to do,
the steps, the output format, and any reference to load. The frontmatter \`description\`
is the trigger surface (it decides firing); this body is what runs once the skill fires.
`;
}

function defaultCommandBody(c: ComponentSpec): string {
  return `# /${c.name}

${c.description}
`;
}

function skillDoc(s: ComponentSpec): string {
  return `---\nname: ${s.name}\ndescription: ${s.description}\n---\n${s.body ?? defaultSkillBody(s)}`;
}

function commandDoc(c: ComponentSpec): string {
  return `---\ndescription: ${c.description}\n---\n${c.body ?? defaultCommandBody(c)}`;
}

/** Emit a complete, gated plugin from a spec. Throws before writing anything if
 *  the spec violates a hard rule or the target exists (without `force`). */
export async function scaffoldPlugin(
  spec: PluginSpec,
  pluginsDir: string,
  opts: { force?: boolean } = {},
): Promise<ScaffoldResult> {
  const skills = spec.skills ?? [];
  const commands = spec.commands ?? [];

  if (!KEBAB.test(spec.name)) throw new Error(`plugin name "${spec.name}" must be kebab-case`);
  if (!spec.description?.trim()) throw new Error("plugin spec needs a non-empty description");
  if (spec.repository !== undefined && typeof spec.repository !== "string") {
    throw new Error("`repository` must be a string");
  }
  if (skills.length + commands.length === 0) {
    throw new Error("a plugin needs at least one component (skill or command)");
  }
  for (const c of [...skills, ...commands]) {
    if (!KEBAB.test(c.name)) throw new Error(`component name "${c.name}" must be kebab-case`);
  }
  // The factory rule: a skill that never fires is worse than one that fails to
  // parse, so a plugin with skills must ship activation cases to gate them.
  if (skills.length > 0 && !(spec.activation && spec.activation.length)) {
    throw new Error(
      "plugin has skills but no activation cases — every skill must ship an activation eval",
    );
  }
  // Cross-check activation cases against the declared skills BEFORE writing, so a
  // typo'd spec fails cleanly instead of leaving a half-scaffolded dir for --force.
  if (skills.length > 0) {
    const skillNames = new Set(skills.map((s) => s.name));
    for (const c of spec.activation ?? []) {
      if (c.expect !== null && !skillNames.has(c.expect)) {
        throw new Error(
          `activation case expects "${c.expect}" but no such skill is declared`,
        );
      }
    }
    for (const s of skills) {
      const hasPositive = (spec.activation ?? []).some((c) => c.expect === s.name);
      if (!hasPositive) {
        throw new Error(
          `skill "${s.name}" has no positive activation case (expect: "${s.name}")`,
        );
      }
    }
  }

  const dir = join(pluginsDir, spec.name);
  if (!opts.force && (await exists(dir))) {
    throw new Error(`${dir} already exists — pass { force: true } to overwrite`);
  }

  const written: string[] = [];

  const manifest: Record<string, unknown> = {
    name: spec.name,
    version: spec.version ?? "0.0.1",
    description: spec.description,
  };
  if (spec.author) manifest.author = spec.author;
  manifest.license = spec.license ?? "MIT";
  if (spec.keywords?.length) manifest.keywords = spec.keywords;
  if (spec.category) manifest.category = spec.category;
  if (spec.repository) manifest.repository = spec.repository;
  await emit(written, join(dir, ".claude-plugin", "plugin.json"), json(manifest));

  for (const s of skills) {
    await emit(written, join(dir, "skills", s.name, "SKILL.md"), skillDoc(s));
  }
  for (const c of commands) {
    await emit(written, join(dir, "commands", `${c.name}.md`), commandDoc(c));
  }

  if (spec.activation?.length) {
    await emit(written, join(dir, "evals", "activation.json"), json({ cases: spec.activation }));
  }
  const expectEntry = spec.expectEntry ?? { version: spec.version ?? "0.0.1" };
  await emit(written, join(dir, "evals", "output.json"), json({ expectEntry }));

  return { dir, written };
}
