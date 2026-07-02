import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitWorkspaceSource } from "@objectcore/registry-core";
import { deriveCatalog } from "@objectcore/registry-core";
import type { MarketplaceJson, WorkspacePlugin } from "@objectcore/registry-core";
import type Anthropic from "@anthropic-ai/sdk";

import {
  parseFrontmatter,
  collectSkillSurfaces,
  collectAgentSurfaces,
  extractSurfaces,
} from "../src/trigger-surface";
import { runOutputEvals } from "../src/output";
import { runCoverageEvals, runReadinessEvals } from "../src/coverage";
import { AnthropicJudge, MockJudge } from "../src/judge";
import { runActivationEvals, runPluginActivation } from "../src/activation";
import { runPluginDelegation } from "../src/delegation";
import { buildEvidence, summarizeEvidence } from "../src/evidence";
import { buildReport, isGreen } from "../src/runner";
import type { ActivationSpec, DelegationSpec, EvalResult, TriggerSurface } from "../src/types";

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

// --- agent surfaces + delegation gate (F4) -----------------------------------

/** Write a minimal agents-only plugin: manifest + agents/<name>.md + delegation.json. */
async function writeAgentPlugin(
  root: string,
  name: string,
  agent: string,
  body: string,
  expectName: string | null,
  withNegative: boolean,
): Promise<void> {
  const dir = join(root, name);
  await mkdir(join(dir, ".claude-plugin"), { recursive: true });
  await writeFile(
    join(dir, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name, version: "0.0.1", description: "d" }) + "\n",
  );
  await mkdir(join(dir, "agents"), { recursive: true });
  await writeFile(
    join(dir, "agents", `${agent}.md`),
    `---\nname: ${agent}\ndescription: handle ${agent} work\n---\n${body}\n`,
  );
  await mkdir(join(dir, "evals"), { recursive: true });
  const cases: { prompt: string; expect: string | null }[] = [
    { prompt: "p", expect: expectName },
  ];
  if (withNegative) cases.push({ prompt: "n", expect: null });
  await writeFile(join(dir, "evals", "delegation.json"), JSON.stringify({ cases }) + "\n");
}

test("extractSurfaces + collectAgentSurfaces pick up agents with kind:'agent'", async () => {
  const root = await mkdtemp(join(tmpdir(), "agt-surf-"));
  try {
    await writeAgentPlugin(root, "agp", "doer", "real body", "doer", true);
    const plugins = await new GitWorkspaceSource(root).listPlugins();
    const surfaces = await extractSurfaces(plugins[0]!);
    const agent = surfaces.find((s) => s.name === "doer");
    expect(agent?.kind).toBe("agent");
    const agents = await collectAgentSurfaces(plugins);
    expect(agents.map((a) => a.name)).toEqual(["doer"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("coverage: an agent with a positive delegation case passes; an uncovered agent fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "agt-cov-"));
  try {
    await writeAgentPlugin(root, "wired", "wired-agent", "real body", "wired-agent", true);
    await writeAgentPlugin(root, "ungated", "lonely-agent", "real body", null, false);
    const plugins = await new GitWorkspaceSource(root).listPlugins();
    const results = await runCoverageEvals(plugins);

    const wired = results.find((r) => r.plugin === "wired" && r.name === "delegates:wired-agent");
    expect(wired?.passed).toBe(true);

    const ungated = results.find((r) => r.plugin === "ungated" && r.name === "delegates:lonely-agent");
    expect(ungated?.passed).toBe(false);
    expect(ungated?.level).toBe("error");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readiness: an agent plugin needs a negative delegation case and a filled body", async () => {
  const root = await mkdtemp(join(tmpdir(), "agt-rdy-"));
  try {
    // no negative case + a forge:todo stub body
    await writeAgentPlugin(root, "stubby", "a", "<!-- forge:todo --> unfilled", "a", false);
    const plugins = await new GitWorkspaceSource(root).listPlugins();
    const results = await runReadinessEvals(plugins);

    const neg = results.find((r) => r.plugin === "stubby" && r.name === "has-negative-delegation");
    expect(neg?.passed).toBe(false);

    const body = results.find((r) => r.plugin === "stubby" && r.name === "agent-body-filled:a");
    expect(body?.passed).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("delegation: scores cases against agent surfaces (pass and fail), carrying confidence", async () => {
  const AGENT_SURFACES: TriggerSurface[] = [
    { id: "p:reviewer", name: "reviewer", kind: "agent", plugin: "p", description: "reviews diffs" },
  ];
  const judge = new MockJudge((prompt, candidates) => {
    const hit = candidates.find((c) => prompt.toLowerCase().includes(c.name));
    return hit
      ? { skill: hit.name, confidence: 0.4, reason: "name in prompt" }
      : { skill: null, confidence: 0.9, reason: "no match" };
  });
  const plugin = { manifest: { name: "p" }, dir: "/x", relDir: "p" } as WorkspacePlugin;
  const spec: DelegationSpec = {
    cases: [
      { prompt: "please reviewer this", expect: "reviewer" }, // pass (low confidence)
      { prompt: "something neutral", expect: null }, // pass
      { prompt: "a neutral prompt with no agent name", expect: "reviewer" }, // fail (fires none)
    ],
  };
  const results = await runPluginDelegation(plugin, spec, AGENT_SURFACES, judge);
  expect(results.map((r) => r.passed)).toEqual([true, true, false]);
  expect(results.every((r) => r.suite === "delegation")).toBe(true);
  expect(results[0]!.confidence).toBe(0.4);
});

// --- EDDOps evidence ---------------------------------------------------------

test("buildEvidence collects failures and flags low-confidence passes as near-misses", () => {
  const results: EvalResult[] = [
    { suite: "output", name: "has-description", level: "error", passed: true, detail: "ok" },
    { suite: "activation", name: "case-0: x", level: "error", passed: false, detail: "misrouted" },
    { suite: "activation", name: "case-1: y", level: "error", passed: true, detail: "fired", confidence: 0.4 },
    { suite: "activation", name: "case-2: z", level: "error", passed: true, detail: "fired", confidence: 0.95 },
  ];
  const report = buildReport(results, ["delegation — no key"]);
  const evidence = buildEvidence(report, { now: "2026-06-26T00:00:00.000Z" });

  expect(evidence.green).toBe(false);
  expect(evidence.failures).toHaveLength(1);
  expect(evidence.failures[0]!.name).toBe("case-0: x");
  // 0.4 ≤ threshold is a near-miss; 0.95 is not.
  expect(evidence.nearMisses.map((n) => n.name)).toEqual(["case-1: y"]);
  expect(evidence.skipped).toEqual(["delegation — no key"]);
  expect(evidence.generatedAt).toBe("2026-06-26T00:00:00.000Z");

  const summary = summarizeEvidence(evidence);
  expect(summary).toContain("gate RED");
  expect(summary).toContain("case-0: x");
  expect(summary).toContain("near-misses");
});

// --- frontmatter block scalars (F56) ------------------------------------------

test("parseFrontmatter folds a `>-` block scalar and emits no bogus keys from continuation lines", () => {
  const raw =
    "---\nname: foo\ndescription: >-\n  Use when X: do Y\n  and also Z.\ntools: Bash\n---\nbody";
  const fm = parseFrontmatter(raw);
  expect(fm.description).toBe("Use when X: do Y and also Z.");
  expect(fm.tools).toBe("Bash");
  // the "Use when X" continuation line must not surface as a key
  expect(Object.keys(fm).sort()).toEqual(["description", "name", "tools"]);
});

test("parseFrontmatter joins a literal `|` block scalar with newlines", () => {
  const raw = "---\nname: foo\ndescription: |\n  line one\n  line two\n---\n";
  expect(parseFrontmatter(raw).description).toBe("line one\nline two");
});

// --- spec-loading discipline (F6: a broken evals/*.json fails closed) ---------

test("a malformed evals/activation.json is a red spec-unreadable result, never 'absent'", async () => {
  const root = await mkdtemp(join(tmpdir(), "spec-bad-"));
  try {
    await writePlugin(root, "corrupt", "s", "s");
    await writeFile(join(root, "corrupt", "evals", "activation.json"), "{bad json,,,");
    const plugins = await new GitWorkspaceSource(root).listPlugins();

    const coverage = await runCoverageEvals(plugins);
    const unreadable = coverage.find((r) => r.name === "spec-unreadable:evals/activation.json");
    expect(unreadable?.passed).toBe(false);
    expect(unreadable?.level).toBe("error");
    expect(unreadable?.detail).toContain("evals/activation.json");

    // The activation layer reports the same red instead of silently running zero cases.
    const activation = await runActivationEvals(plugins, [], new MockJudge());
    expect(
      activation.some((r) => r.name === "spec-unreadable:evals/activation.json" && !r.passed),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a wrong-shape spec ({"cases": {}}) is a red result, not a TypeError', async () => {
  const root = await mkdtemp(join(tmpdir(), "spec-shape-"));
  try {
    await writePlugin(root, "shapely", "s", "s");
    await writeFile(join(root, "shapely", "evals", "activation.json"), JSON.stringify({ cases: {} }));
    const plugins = await new GitWorkspaceSource(root).listPlugins();
    const results = await runCoverageEvals(plugins);
    const unreadable = results.find((r) => r.name === "spec-unreadable:evals/activation.json");
    expect(unreadable?.passed).toBe(false);
    expect(unreadable?.detail).toContain("`cases` must be an array");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a malformed evals/output.json fails the output suite naming the file", async () => {
  const root = await mkdtemp(join(tmpdir(), "spec-out-"));
  try {
    const dir = join(root, "outbad");
    await mkdir(join(dir, ".claude-plugin"), { recursive: true });
    await writeFile(
      join(dir, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "outbad", version: "0.0.1", description: "d" }) + "\n",
    );
    await mkdir(join(dir, "evals"), { recursive: true });
    await writeFile(join(dir, "evals", "output.json"), "not json at all");
    const plugins = await new GitWorkspaceSource(root).listPlugins();
    const catalog: MarketplaceJson = { name: "objectcore", owner: { name: "Dakota" }, plugins: [] };
    const results = await runOutputEvals(plugins, catalog);
    const unreadable = results.find((r) => r.name === "spec-unreadable:evals/output.json");
    expect(unreadable?.passed).toBe(false);
    expect(unreadable?.level).toBe("error");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- expect-exists (F9: stale cases must fail offline) ------------------------

test("coverage: an activation case expecting an undeclared skill fails expect-exists offline", async () => {
  const root = await mkdtemp(join(tmpdir(), "cov-ghost-"));
  try {
    await writePlugin(root, "stale", "real-skill", "ghost-skill");
    const plugins = await new GitWorkspaceSource(root).listPlugins();
    const results = await runCoverageEvals(plugins);
    const ghost = results.find((r) => r.plugin === "stale" && r.name === "expect-exists:case-0");
    expect(ghost?.passed).toBe(false);
    expect(ghost?.detail).toContain('unknown skill "ghost-skill"');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("coverage: expect-exists runs even when the plugin declares zero skills (fully-deleted skill set)", async () => {
  const root = await mkdtemp(join(tmpdir(), "cov-orphan-"));
  try {
    const dir = join(root, "orphan");
    await mkdir(join(dir, ".claude-plugin"), { recursive: true });
    await writeFile(
      join(dir, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "orphan", version: "0.0.1", description: "d" }) + "\n",
    );
    await mkdir(join(dir, "evals"), { recursive: true });
    await writeFile(
      join(dir, "evals", "activation.json"),
      JSON.stringify({ cases: [{ prompt: "p", expect: "gone" }] }) + "\n",
    );
    const plugins = await new GitWorkspaceSource(root).listPlugins();
    const results = await runCoverageEvals(plugins);
    const ghost = results.find((r) => r.plugin === "orphan" && r.name === "expect-exists:case-0");
    expect(ghost?.passed).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("coverage: a delegation case expecting an undeclared agent fails delegation-expect-exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "cov-agt-ghost-"));
  try {
    await writeAgentPlugin(root, "stale", "real-agent", "real body", "ghost-agent", true);
    const plugins = await new GitWorkspaceSource(root).listPlugins();
    const results = await runCoverageEvals(plugins);
    const ghost = results.find(
      (r) => r.plugin === "stale" && r.name === "delegation-expect-exists:case-0",
    );
    expect(ghost?.passed).toBe(false);
    expect(ghost?.detail).toContain('unknown agent "ghost-agent"');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- description floor (F56) ---------------------------------------------------

test("coverage: a skill whose description parses to empty fails has-description", async () => {
  const root = await mkdtemp(join(tmpdir(), "cov-desc-"));
  try {
    const dir = join(root, "blank");
    await mkdir(join(dir, ".claude-plugin"), { recursive: true });
    await writeFile(
      join(dir, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "blank", version: "0.0.1", description: "d" }) + "\n",
    );
    await mkdir(join(dir, "skills", "s"), { recursive: true });
    await writeFile(join(dir, "skills", "s", "SKILL.md"), "---\nname: s\ndescription:\n---\nbody\n");
    await mkdir(join(dir, "evals"), { recursive: true });
    await writeFile(
      join(dir, "evals", "activation.json"),
      JSON.stringify({ cases: [{ prompt: "p", expect: "s" }, { prompt: "n", expect: null }] }) + "\n",
    );
    const plugins = await new GitWorkspaceSource(root).listPlugins();
    const results = await runCoverageEvals(plugins);
    const desc = results.find((r) => r.plugin === "blank" && r.name === "has-description:s");
    expect(desc?.passed).toBe(false);
    expect(desc?.level).toBe("error");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- placeholder-case readiness (F16) ------------------------------------------

test("readiness: the metaPluginSpec placeholder positive case is not ship-ready", async () => {
  const root = await mkdtemp(join(tmpdir(), "rdy-ph-"));
  try {
    const dir = join(root, "meta-ish");
    await mkdir(join(dir, ".claude-plugin"), { recursive: true });
    await writeFile(
      join(dir, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "meta-ish", version: "0.0.1", description: "d" }) + "\n",
    );
    await mkdir(join(dir, "skills", "s"), { recursive: true });
    await writeFile(join(dir, "skills", "s", "SKILL.md"), "---\nname: s\ndescription: d\n---\nreal body\n");
    await mkdir(join(dir, "evals"), { recursive: true });
    await writeFile(
      join(dir, "evals", "activation.json"),
      JSON.stringify({
        cases: [
          {
            prompt: "Help me with: d",
            expect: "s",
            note: "auto-added so the skill is gated — replace with a real positive prompt",
          },
          { prompt: "n", expect: null },
        ],
      }) + "\n",
    );
    const plugins = await new GitWorkspaceSource(root).listPlugins();
    const results = await runReadinessEvals(plugins);
    const placeholder = results.find(
      (r) => r.plugin === "meta-ish" && r.name === "case-filled:activation:case-0",
    );
    expect(placeholder?.passed).toBe(false);
    expect(placeholder?.detail).toContain("placeholder");
    // ...but structural coverage still passes: the case IS a positive for `s`.
    const coverage = await runCoverageEvals(plugins);
    expect(coverage.find((r) => r.name === "covers:s")?.passed).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readiness: a case carrying the forge:todo stub marker in its note is not ship-ready", async () => {
  const root = await mkdtemp(join(tmpdir(), "rdy-stub-"));
  try {
    await writeAgentPlugin(root, "marked", "a", "real body", "a", true);
    await writeFile(
      join(root, "marked", "evals", "delegation.json"),
      JSON.stringify({
        cases: [
          { prompt: "delegate to a", expect: "a", note: "<!-- forge:todo --> auto-added" },
          { prompt: "n", expect: null },
        ],
      }) + "\n",
    );
    const plugins = await new GitWorkspaceSource(root).listPlugins();
    const results = await runReadinessEvals(plugins);
    const placeholder = results.find(
      (r) => r.plugin === "marked" && r.name === "case-filled:delegation:case-0",
    );
    expect(placeholder?.passed).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- judge fail-closed (F8) ----------------------------------------------------

const fakeClient = (res: object): Anthropic =>
  ({ messages: { create: async () => res } }) as unknown as Anthropic;

test("AnthropicJudge fails closed on a verdict-less response (no text block)", async () => {
  const judge = new AnthropicJudge({
    client: fakeClient({ content: [], stop_reason: "max_tokens" }),
  });
  await expect(judge.route("p", SURFACES)).rejects.toThrow(/no text block/);
});

test("AnthropicJudge clamps confidence to [0,1] and annotates an unknown skill name", async () => {
  const mk = (payload: object): AnthropicJudge =>
    new AnthropicJudge({
      client: fakeClient({
        content: [{ type: "text", text: JSON.stringify(payload) }],
        stop_reason: "end_turn",
      }),
    });

  const over = await mk({ skill: "alpha", confidence: 3, reason: "r" }).route("p", SURFACES);
  expect(over.skill).toBe("alpha");
  expect(over.confidence).toBe(1);
  expect(over.reason).toBe("r");

  const ghost = await mk({ skill: "ghost", confidence: -2, reason: "r" }).route("p", SURFACES);
  // Kept (not thrown): a hallucinated route is a legitimate failure of the case,
  // and the annotated reason makes the failure detail diagnosable.
  expect(ghost.skill).toBe("ghost");
  expect(ghost.confidence).toBe(0);
  expect(ghost.reason).toContain('unknown skill "ghost"');
});
