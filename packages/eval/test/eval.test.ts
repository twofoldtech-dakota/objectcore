import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitWorkspaceSource } from "@objectcore/registry-core";
import { deriveCatalog } from "@objectcore/registry-core";
import type { MarketplaceJson, WorkspacePlugin } from "@objectcore/registry-core";

import { parseFrontmatter, collectSkillSurfaces, extractSurfaces } from "../src/trigger-surface";
import { runOutputEvals } from "../src/output";
import { runCoverageEvals, runReadinessEvals } from "../src/coverage";
import { MockJudge } from "../src/judge";
import { runPluginActivation } from "../src/activation";
import { buildReport, isGreen } from "../src/runner";
import type { ActivationSpec, TriggerSurface } from "../src/types";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const pluginsDir = join(repoRoot, "plugins");

async function loadPlugins(): Promise<WorkspacePlugin[]> {
  return new GitWorkspaceSource(pluginsDir).listPlugins();
}

// --- trigger-surface extraction ---------------------------------------------

test("parseFrontmatter reads simple key: value and keeps colons in the value", () => {
  const fm = parseFrontmatter("---\nname: foo\ndescription: Use when X: do Y.\n---\nbody");
  expect(fm.name).toBe("foo");
  expect(fm.description).toBe("Use when X: do Y.");
});

test("parseFrontmatter returns {} when there is no frontmatter", () => {
  expect(parseFrontmatter("# just a heading\n")).toEqual({});
});

test("collectSkillSurfaces finds the real plugin-forge skill with its description", async () => {
  const plugins = await loadPlugins();
  const surfaces = await collectSkillSurfaces(plugins);
  const wgs = surfaces.find((s) => s.name === "writing-great-skills");
  expect(wgs).toBeDefined();
  expect(wgs!.kind).toBe("skill");
  expect(wgs!.plugin).toBe("plugin-forge");
  expect(wgs!.id).toBe("plugin-forge:writing-great-skills");
  expect(wgs!.description.length).toBeGreaterThan(0);
});

test("extractSurfaces picks up commands too (hello-objectcore has a command, no skill)", async () => {
  const plugins = await loadPlugins();
  const hello = plugins.find((p) => p.manifest.name === "hello-objectcore")!;
  const surfaces = await extractSurfaces(hello);
  expect(surfaces.some((s) => s.kind === "command" && s.name === "hello")).toBe(true);
  expect(surfaces.some((s) => s.kind === "skill")).toBe(false);
});

// --- output evals ------------------------------------------------------------

test("output evals: real catalog passes, and hello-objectcore's expectEntry matches", async () => {
  const plugins = await loadPlugins();
  const catalog = deriveCatalog(plugins, {
    name: "objectcore",
    owner: { name: "Dakota" },
    pluginRoot: "./plugins",
  });
  const results = await runOutputEvals(plugins, catalog);
  const errors = results.filter((r) => !r.passed && r.level === "error");
  expect(errors).toEqual([]);
  // The per-plugin expectEntry assertions actually ran.
  expect(results.some((r) => r.name.startsWith("expect-entry:") && r.passed)).toBe(true);
});

test("output evals: a description-less entry fails has-description at error level", async () => {
  const catalog: MarketplaceJson = {
    name: "objectcore",
    owner: { name: "Dakota" },
    plugins: [{ name: "ghost", source: "ghost" }],
  };
  const results = await runOutputEvals([], catalog);
  const desc = results.find((r) => r.plugin === "ghost" && r.name === "has-description");
  expect(desc?.passed).toBe(false);
  expect(desc?.level).toBe("error");
});

// --- coverage evals ----------------------------------------------------------

/** Write a minimal plugin (one skill + optional activation spec) to a temp dir. */
async function writePlugin(
  root: string,
  name: string,
  skill: string,
  expectName: string | null,
): Promise<void> {
  const dir = join(root, name);
  await mkdir(join(dir, ".claude-plugin"), { recursive: true });
  await writeFile(
    join(dir, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name, version: "0.0.1", description: "d" }) + "\n",
  );
  await mkdir(join(dir, "skills", skill), { recursive: true });
  await writeFile(
    join(dir, "skills", skill, "SKILL.md"),
    `---\nname: ${skill}\ndescription: d\n---\nbody\n`,
  );
  await mkdir(join(dir, "evals"), { recursive: true });
  await writeFile(
    join(dir, "evals", "activation.json"),
    JSON.stringify({ cases: [{ prompt: "p", expect: expectName }] }) + "\n",
  );
}

test("coverage: a skill with a matching positive case passes; an uncovered skill fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "cov-"));
  try {
    await writePlugin(root, "wired", "wired-skill", "wired-skill"); // covered
    await writePlugin(root, "ungated", "lonely-skill", null); // skill exists, only a negative case
    const plugins = await new GitWorkspaceSource(root).listPlugins();
    const results = await runCoverageEvals(plugins);

    const wired = results.find((r) => r.plugin === "wired");
    expect(wired?.passed).toBe(true);

    const ungated = results.find((r) => r.plugin === "ungated");
    expect(ungated?.passed).toBe(false);
    expect(ungated?.level).toBe("error");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("coverage: a skill-bearing plugin with no negative case fails has-negative-case", async () => {
  const root = await mkdtemp(join(tmpdir(), "cov-neg-"));
  try {
    const dir = join(root, "no-neg");
    await mkdir(join(dir, ".claude-plugin"), { recursive: true });
    await writeFile(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "no-neg", version: "0.0.1", description: "d" }) + "\n");
    await mkdir(join(dir, "skills", "s"), { recursive: true });
    await writeFile(join(dir, "skills", "s", "SKILL.md"), `---\nname: s\ndescription: d\n---\nreal body here\n`);
    await mkdir(join(dir, "evals"), { recursive: true });
    await writeFile(join(dir, "evals", "activation.json"), JSON.stringify({ cases: [{ prompt: "p", expect: "s" }] }) + "\n");
    const plugins = await new GitWorkspaceSource(root).listPlugins();
    const results = await runReadinessEvals(plugins);
    const neg = results.find((r) => r.plugin === "no-neg" && r.name === "has-negative-case");
    expect(neg?.passed).toBe(false);
    expect(neg?.level).toBe("error");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("coverage: a skill body still carrying the forge:todo stub fails body-filled", async () => {
  const root = await mkdtemp(join(tmpdir(), "cov-stub-"));
  try {
    const dir = join(root, "stubby");
    await mkdir(join(dir, ".claude-plugin"), { recursive: true });
    await writeFile(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "stubby", version: "0.0.1", description: "d" }) + "\n");
    await mkdir(join(dir, "skills", "s"), { recursive: true });
    await writeFile(join(dir, "skills", "s", "SKILL.md"), `---\nname: s\ndescription: d\n---\n<!-- forge:todo --> unfilled\n`);
    await mkdir(join(dir, "evals"), { recursive: true });
    await writeFile(join(dir, "evals", "activation.json"), JSON.stringify({ cases: [{ prompt: "p", expect: "s" }, { prompt: "n", expect: null }] }) + "\n");
    const plugins = await new GitWorkspaceSource(root).listPlugins();
    const results = await runReadinessEvals(plugins);
    const body = results.find((r) => r.plugin === "stubby" && r.name === "body-filled:s");
    expect(body?.passed).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- judge + activation ------------------------------------------------------

const SURFACES: TriggerSurface[] = [
  { id: "p:alpha", name: "alpha", kind: "skill", plugin: "p", description: "handle alpha widget tasks" },
  { id: "p:beta", name: "beta", kind: "skill", plugin: "p", description: "handle beta gadget tasks" },
];

test("MockJudge default heuristic routes to the overlapping surface", async () => {
  const judge = new MockJudge();
  const hit = await judge.route("please work on the alpha widget now", SURFACES);
  expect(hit.skill).toBe("alpha");
  const miss = await judge.route("completely unrelated zzzz qqqq", SURFACES);
  expect(miss.skill).toBeNull();
});

test("activation: scores cases against the spec (pass and fail)", async () => {
  // Deterministic injected judge: fire the candidate whose name appears in the prompt.
  const judge = new MockJudge((prompt, candidates) => {
    const hit = candidates.find((c) => prompt.toLowerCase().includes(c.name));
    return hit
      ? { skill: hit.name, confidence: 1, reason: "name in prompt" }
      : { skill: null, confidence: 1, reason: "no match" };
  });
  const plugin = { manifest: { name: "p" }, dir: "/x", relDir: "p" } as WorkspacePlugin;
  const spec: ActivationSpec = {
    cases: [
      { prompt: "do the alpha thing", expect: "alpha" }, // pass
      { prompt: "something neutral", expect: null }, // pass
      { prompt: "the beta thing", expect: "alpha" }, // fail (fires beta)
    ],
  };
  const results = await runPluginActivation(plugin, spec, SURFACES, judge);
  expect(results.map((r) => r.passed)).toEqual([true, true, false]);
  expect(results.every((r) => r.level === "error")).toBe(true);
});

test("buildReport tallies and isGreen reflects error-level failures", async () => {
  const judge = new MockJudge(() => ({ skill: null, confidence: 1, reason: "x" }));
  const plugin = { manifest: { name: "p" }, dir: "/x", relDir: "p" } as WorkspacePlugin;
  const spec: ActivationSpec = { cases: [{ prompt: "fire alpha", expect: "alpha" }] };
  const results = await runPluginActivation(plugin, spec, SURFACES, judge);
  const report = buildReport(results, ["activation — example skip"]);
  expect(report.failed).toBe(1);
  expect(isGreen(report)).toBe(false);
  expect(report.skipped.length).toBe(1);
});
