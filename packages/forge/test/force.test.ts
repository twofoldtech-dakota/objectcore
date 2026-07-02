// F13 — `force` re-scaffold semantics: the spec is the FULL definition of the
// plugin. A re-scaffold removes stale scaffolder-owned artifacts of the previous
// spec (a renamed skill's old dir, a dropped `.mcp.json` that would trip the
// publish-time provenance gate) and reports them via ScaffoldResult.removed —
// while never touching files the spec cannot express (CHANGELOG.md, hand-authored
// hook scripts, reference material).

import { test, expect } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldPlugin } from "../src/scaffold";
import type { PluginSpec } from "../src/types";

const tmp = () => mkdtemp(join(tmpdir(), "forge-force-"));

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

test("force re-scaffold removes a renamed skill's old dir and reports it", async () => {
  const dir = await tmp();
  try {
    await scaffoldPlugin(
      {
        name: "renamer",
        description: "x",
        skills: [{ name: "old-skill", description: "Use when old." }],
        activation: [{ prompt: "old", expect: "old-skill" }],
      },
      dir,
    );
    const { dir: pluginDir, removed } = await scaffoldPlugin(
      {
        name: "renamer",
        description: "x",
        skills: [{ name: "new-skill", description: "Use when new." }],
        activation: [{ prompt: "new", expect: "new-skill" }],
      },
      dir,
      { force: true },
    );
    expect(await exists(join(pluginDir, "skills", "old-skill"))).toBe(false);
    expect(await exists(join(pluginDir, "skills", "new-skill", "SKILL.md"))).toBe(true);
    expect(removed).toContain(join(pluginDir, "skills", "old-skill"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("force re-scaffold deletes a stale .mcp.json when the spec drops mcp (the provenance-gate trap)", async () => {
  const dir = await tmp();
  try {
    await scaffoldPlugin(
      {
        name: "was-mcp",
        description: "x",
        commands: [{ name: "go", description: "Go." }],
        mcp: { server: { command: "bun" } },
      },
      dir,
    );
    const { dir: pluginDir, removed } = await scaffoldPlugin(
      { name: "was-mcp", description: "x", commands: [{ name: "go", description: "Go." }] },
      dir,
      { force: true },
    );
    expect(await exists(join(pluginDir, ".mcp.json"))).toBe(false);
    expect(removed).toContain(join(pluginDir, ".mcp.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("force re-scaffold drops stale component files and eval specs the new spec no longer declares", async () => {
  const dir = await tmp();
  try {
    await scaffoldPlugin(
      {
        name: "shrinker",
        description: "x",
        commands: [{ name: "keep-cmd", description: "Keep." }, { name: "drop-cmd", description: "Drop." }],
        agents: [{ name: "helper", description: "Delegate when helping." }],
        delegation: [{ prompt: "help", expect: "helper" }],
      },
      dir,
    );
    const { dir: pluginDir, removed } = await scaffoldPlugin(
      { name: "shrinker", description: "x", commands: [{ name: "keep-cmd", description: "Keep." }] },
      dir,
      { force: true },
    );
    expect(await exists(join(pluginDir, "commands", "keep-cmd.md"))).toBe(true);
    expect(await exists(join(pluginDir, "commands", "drop-cmd.md"))).toBe(false);
    expect(await exists(join(pluginDir, "agents", "helper.md"))).toBe(false);
    expect(await exists(join(pluginDir, "evals", "delegation.json"))).toBe(false);
    expect(removed).toEqual(
      expect.arrayContaining([
        join(pluginDir, "commands", "drop-cmd.md"),
        join(pluginDir, "agents", "helper.md"),
        join(pluginDir, "evals", "delegation.json"),
      ]),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("force re-scaffold never touches non-scaffolder files (CHANGELOG, hook scripts, skill references)", async () => {
  const dir = await tmp();
  try {
    const spec: PluginSpec = {
      name: "keeper",
      description: "x",
      skills: [{ name: "s", description: "Use when s." }],
      activation: [{ prompt: "s please", expect: "s" }],
      hooks: { Stop: [{ hooks: [{ type: "command", command: "bun run hooks/run.ts" }] }] },
    };
    const { dir: pluginDir } = await scaffoldPlugin(spec, dir);
    // Files the spec cannot express: release-owned, hand-authored, reference material.
    await writeFile(join(pluginDir, "CHANGELOG.md"), "# changes\n", "utf8");
    await writeFile(join(pluginDir, "hooks", "run.ts"), "// hand-authored\n", "utf8");
    await writeFile(join(pluginDir, "skills", "s", "reference.md"), "extra context\n", "utf8");

    const { removed } = await scaffoldPlugin(spec, dir, { force: true });
    expect(removed).toEqual([]);
    expect(await readFile(join(pluginDir, "CHANGELOG.md"), "utf8")).toBe("# changes\n");
    expect(await readFile(join(pluginDir, "hooks", "run.ts"), "utf8")).toBe("// hand-authored\n");
    expect(await readFile(join(pluginDir, "skills", "s", "reference.md"), "utf8")).toBe("extra context\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a fresh scaffold reports removed: [] ", async () => {
  const dir = await tmp();
  try {
    const { removed } = await scaffoldPlugin(
      { name: "fresh", description: "x", commands: [{ name: "c", description: "d" }] },
      dir,
    );
    expect(removed).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
