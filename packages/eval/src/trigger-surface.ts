// Extract trigger surfaces from a plugin's components on disk.
//
// A skill lives at `skills/<name>/SKILL.md`; a command at `commands/<name>.md`.
// Each carries YAML frontmatter whose `name` + `description` ARE the trigger
// surface (CONTEXT.md). Activation evals route against skill surfaces; commands
// are surfaced too (kind: "command") for completeness, but they are explicitly
// invoked, not auto-activated, so the activation layer filters to skills.

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { WorkspacePlugin } from "@objectcore/registry-core";
import type { TriggerSurface } from "./types";

/** Minimal frontmatter reader: the `--- ... ---` block of simple `key: value` lines.
 *  Skills/commands use single-line name/description, so we split on the first `: `
 *  only and keep the remainder verbatim (descriptions routinely contain colons). */
export function parseFrontmatter(raw: string): Record<string, string> {
  const m = /^---\s*\n([\s\S]*?)\n---/.exec(raw);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    if (!key) continue;
    out[key] = line.slice(i + 1).trim();
  }
  return out;
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function readSkillSurfaces(
  plugin: WorkspacePlugin,
  skillsDir: string,
): Promise<TriggerSurface[]> {
  if (!(await isDir(skillsDir))) return [];
  const surfaces: TriggerSurface[] = [];
  for (const entry of (await readdir(skillsDir)).sort()) {
    if (entry.startsWith(".")) continue;
    const skillMd = join(skillsDir, entry, "SKILL.md");
    let raw: string;
    try {
      raw = await readFile(skillMd, "utf8");
    } catch {
      continue; // dir without SKILL.md — not a skill
    }
    const fm = parseFrontmatter(raw);
    const name = fm.name || entry;
    surfaces.push({
      id: `${plugin.manifest.name}:${name}`,
      name,
      kind: "skill",
      plugin: plugin.manifest.name,
      description: fm.description ?? "",
    });
  }
  return surfaces;
}

async function readCommandSurfaces(
  plugin: WorkspacePlugin,
  commandsDir: string,
): Promise<TriggerSurface[]> {
  if (!(await isDir(commandsDir))) return [];
  const surfaces: TriggerSurface[] = [];
  for (const entry of (await readdir(commandsDir)).sort()) {
    if (!entry.endsWith(".md") || entry.startsWith(".")) continue;
    const raw = await readFile(join(commandsDir, entry), "utf8");
    const fm = parseFrontmatter(raw);
    const name = entry.slice(0, -".md".length);
    surfaces.push({
      id: `${plugin.manifest.name}:${name}`,
      name,
      kind: "command",
      plugin: plugin.manifest.name,
      description: fm.description ?? "",
    });
  }
  return surfaces;
}

/** All trigger surfaces (skills + commands) exposed by one plugin. */
export async function extractSurfaces(
  plugin: WorkspacePlugin,
): Promise<TriggerSurface[]> {
  // Honor manifest path overrides; otherwise the conventional component dirs.
  const skillsDir = join(plugin.dir, plugin.manifest.skills ?? "skills");
  const commandsDir = join(plugin.dir, plugin.manifest.commands ?? "commands");
  const [skills, commands] = await Promise.all([
    readSkillSurfaces(plugin, skillsDir),
    readCommandSurfaces(plugin, commandsDir),
  ]);
  return [...skills, ...commands];
}

/** All skill surfaces across the workspace — the candidate set for a router. */
export async function collectSkillSurfaces(
  plugins: WorkspacePlugin[],
): Promise<TriggerSurface[]> {
  const all = await Promise.all(plugins.map((p) => extractSurfaces(p)));
  return all.flat().filter((s) => s.kind === "skill");
}
