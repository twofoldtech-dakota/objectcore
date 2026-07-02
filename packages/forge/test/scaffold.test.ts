import { test, expect } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
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

test("manifest shape guards (keywords/version/author) reject BEFORE creating the plugin dir", async () => {
  // Mirrors of registry-core's validateSchema, run pre-write: a JSON spec with a
  // wrong-typed field must fail with nothing on disk, not leave a half-scaffold
  // that validateSchema rejects post-write and --force has to clean up.
  const dirExists = async (p: string) => {
    try {
      await stat(p);
      return true;
    } catch {
      return false;
    }
  };
  const cases: { spec: unknown; throws: RegExp }[] = [
    {
      spec: { name: "bad-kw", description: "x", keywords: "objectcore", commands: [{ name: "c", description: "d" }] },
      throws: /`keywords` must be an array of strings/,
    },
    {
      spec: { name: "bad-ver", description: "x", version: 1, commands: [{ name: "c", description: "d" }] },
      throws: /`version` must be a string/,
    },
    {
      spec: { name: "bad-author", description: "x", author: "dakota", commands: [{ name: "c", description: "d" }] },
      throws: /`author` must be an object with a non-empty string `name`/,
    },
  ];
  const dir = await tmp();
  try {
    for (const c of cases) {
      await expect(scaffoldPlugin(c.spec as PluginSpec, dir)).rejects.toThrow(c.throws);
      expect(await dirExists(join(dir, (c.spec as PluginSpec).name))).toBe(false);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("metaPluginSpec rejects a bogus archetype with the legal values named", () => {
  expect(() =>
    metaPluginSpec({
      archetype: "banana" as never,
      name: "p",
      description: "x",
      skill: { name: "s", description: "d" },
      command: { name: "c", description: "d" },
    }),
  ).toThrow(/unknown archetype "banana" \(must be "governance" \| "generator"\)/);
});

test("metaPluginSpec rejects a meta-spec missing its skill or command (no raw TypeError)", () => {
  const base = { archetype: "governance" as const, name: "p", description: "x" };
  expect(() =>
    metaPluginSpec({ ...base, command: { name: "c", description: "d" } } as never),
  ).toThrow(/meta-spec needs a `skill` with a name and description/);
  expect(() =>
    metaPluginSpec({ ...base, skill: { name: "s", description: "d" } } as never),
  ).toThrow(/meta-spec needs a `command` with a name and description/);
  expect(() =>
    metaPluginSpec({
      ...base,
      name: "  ",
      skill: { name: "s", description: "d" },
      command: { name: "c", description: "d" },
    }),
  ).toThrow(/non-empty `name`/);
});

test("metaPluginSpec's auto-added placeholder case carries the forge:todo stub marker", () => {
  // The injected prompt echoes the trigger surface (trivially green under any
  // judge), so it is marked with the SAME sentinel as unfilled bodies — the
  // ship-readiness gate can then refuse a meta-plugin that never replaced it.
  const spec = metaPluginSpec({
    archetype: "generator",
    name: "gen-things",
    description: "Generates things.",
    skill: { name: "thing-making", description: "Use when making things." },
    command: { name: "make-thing", description: "Make a thing." },
  });
  const placeholder = spec.activation?.find((c) => c.expect === "thing-making");
  expect(placeholder?.note).toContain("<!-- forge:todo -->");
});
