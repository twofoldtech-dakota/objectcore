import { test, expect } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GitWorkspaceSource,
  deriveCatalog,
  validateAll,
} from "@objectcore/registry-core";
import { runOutputEvals, collectSkillSurfaces } from "@objectcore/eval";
import { scaffoldPlugin } from "../src/scaffold";
import { metaPluginSpec } from "../src/meta";
import { runCoverageEvals } from "@objectcore/eval";
import type { PluginSpec } from "../src/types";

const deriveOpts = { name: "objectcore", owner: { name: "x" }, pluginRoot: "./plugins" };

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "forge-"));
}

test("scaffoldPlugin writes a valid, gated plugin that passes validation + output evals", async () => {
  const spec: PluginSpec = {
    name: "demo-forged",
    description: "A forged demo plugin.",
    keywords: ["objectcore", "demo"],
    skills: [{ name: "do-the-thing", description: "Use when the user wants the thing done." }],
    activation: [
      { prompt: "please do the thing", expect: "do-the-thing" },
      { prompt: "unrelated request", expect: null },
    ],
  };
  const dir = await tmp();
  try {
    const result = await scaffoldPlugin(spec, dir);
    expect(result.written.some((w) => w.endsWith("plugin.json"))).toBe(true);
    expect(result.written.some((w) => w.includes("SKILL.md"))).toBe(true);
    expect(result.written.some((w) => w.endsWith("activation.json"))).toBe(true);

    const manifest = JSON.parse(
      await readFile(join(result.dir, ".claude-plugin", "plugin.json"), "utf8"),
    );
    expect(manifest.name).toBe("demo-forged");
    expect(manifest.license).toBe("MIT");

    // The scaffolded plugin must pass the deterministic floor + output evals.
    const plugins = await new GitWorkspaceSource(dir).listPlugins();
    const catalog = deriveCatalog(plugins, deriveOpts);
    const validationErrors = (await validateAll(plugins, catalog)).filter((i) => i.level === "error");
    expect(validationErrors).toEqual([]);
    const outputErrors = (await runOutputEvals(plugins, catalog)).filter(
      (r) => !r.passed && r.level === "error",
    );
    expect(outputErrors).toEqual([]);

    // Its skill surface is discoverable (so the activation gate can route it).
    const surfaces = await collectSkillSurfaces(plugins);
    expect(surfaces.find((s) => s.name === "do-the-thing")).toBeDefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scaffoldPlugin refuses a skill without activation cases (the gate rule)", async () => {
  const dir = await tmp();
  try {
    await expect(
      scaffoldPlugin(
        { name: "no-eval", description: "x", skills: [{ name: "s", description: "d" }] },
        dir,
      ),
    ).rejects.toThrow(/activation/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("metaPluginSpec tags meta keywords, guarantees coverage, and scaffolds clean", async () => {
  // No activation cases provided -> metaPluginSpec must synthesize a positive one.
  const spec = metaPluginSpec({
    archetype: "governance",
    name: "naming-czar",
    description: "Governs plugin naming conventions.",
    skill: { name: "naming-rules", description: "Use when reviewing plugin or component names." },
    command: { name: "check-names", description: "Check names against the conventions." },
  });
  expect(spec.keywords).toContain("meta");
  expect(spec.keywords).toContain("governance");
  expect(spec.activation?.some((c) => c.expect === "naming-rules")).toBe(true);

  const dir = await tmp();
  try {
    await scaffoldPlugin(spec, dir);
    const plugins = await new GitWorkspaceSource(dir).listPlugins();
    const catalog = deriveCatalog(plugins, deriveOpts);
    const validationErrors = (await validateAll(plugins, catalog)).filter((i) => i.level === "error");
    expect(validationErrors).toEqual([]);
    const coverageErrors = (await runCoverageEvals(plugins)).filter(
      (r) => !r.passed && r.level === "error",
    );
    expect(coverageErrors).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scaffoldPlugin rejects an activation case that names an undeclared skill", async () => {
  const dir = await tmp();
  try {
    await expect(
      scaffoldPlugin(
        { name: "typo-plugin", description: "x", skills: [{ name: "do-thing", description: "d" }], activation: [{ prompt: "p", expect: "do-thingg" }] },
        dir,
      ),
    ).rejects.toThrow(/no such skill is declared/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scaffoldPlugin rejects a skill with only a negative case (no positive)", async () => {
  const dir = await tmp();
  try {
    await expect(
      scaffoldPlugin(
        { name: "neg-only", description: "x", skills: [{ name: "do-thing", description: "d" }], activation: [{ prompt: "p", expect: null }] },
        dir,
      ),
    ).rejects.toThrow(/no positive activation case/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a scaffolded skill with no body gets the visible forge:todo stub marker", async () => {
  const dir = await tmp();
  try {
    const { dir: pluginDir } = await scaffoldPlugin(
      { name: "stub-body", description: "x", skills: [{ name: "do-thing", description: "Use when the user wants the thing." }], activation: [{ prompt: "do the thing", expect: "do-thing" }] },
      dir,
    );
    const body = await readFile(join(pluginDir, "skills", "do-thing", "SKILL.md"), "utf8");
    expect(body).toContain("forge:todo");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scaffoldPlugin rejects non-kebab names and refuses to overwrite", async () => {
  const dir = await tmp();
  try {
    await expect(
      scaffoldPlugin(
        { name: "BadName", description: "x", commands: [{ name: "c", description: "d" }] },
        dir,
      ),
    ).rejects.toThrow(/kebab/);

    const spec: PluginSpec = {
      name: "ok-plugin",
      description: "x",
      commands: [{ name: "c", description: "d" }],
    };
    await scaffoldPlugin(spec, dir);
    await expect(scaffoldPlugin(spec, dir)).rejects.toThrow(/exists/);
    // force overwrites
    await scaffoldPlugin(spec, dir, { force: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
