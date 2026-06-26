// F7 Phase 0 — the golden-snapshot corpus (plan 009, Pillar 2.2).
//
// A frozen set of representative PluginSpecs, each scaffolded and compared to a
// committed golden file tree (golden/<name>.json: { relpath -> contents }). The
// snapshots ARE the definition of "correct emission": a self-edit to scaffold.ts
// that CLAIMS to be behavior-preserving must keep every golden byte-identical.
// Changing a golden is a TCB edit (this file + golden/ live in the TCB) — a human
// re-bless, never something the optimizer can do silently.
//
// To re-bless after an intentional change: `UPDATE_GOLDENS=1 bun test packages/forge/test/golden.test.ts`,
// then review the golden/ diff like any other change.

import { test, expect } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { scaffoldPlugin } from "../src/scaffold";
import type { PluginSpec } from "../src/types";

const GOLDEN_DIR = join(import.meta.dir, "golden");
const UPDATE = !!process.env.UPDATE_GOLDENS;

/** Scaffold a spec into a tmpdir and return its emitted tree as a sorted
 *  { relpath -> contents } map (paths relative to the plugin dir, forward slashes). */
async function emittedTree(spec: PluginSpec): Promise<Record<string, string>> {
  const tmp = await mkdtemp(join(tmpdir(), "forge-golden-"));
  try {
    const { dir, written } = await scaffoldPlugin(spec, tmp, { force: true });
    const tree: Record<string, string> = {};
    for (const abs of written) {
      const rel = relative(dir, abs).replace(/\\/g, "/");
      tree[rel] = await readFile(abs, "utf8");
    }
    return Object.fromEntries(Object.entries(tree).sort(([a], [b]) => (a < b ? -1 : 1)));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

// One representative spec per primitive + combinations, chosen so that EVERY emit
// branch in scaffold.ts is locked by at least one golden (default bodies AND
// provided bodies; each component dir; settings; the eval specs; custom expectEntry).
const SPECS: { name: string; spec: PluginSpec }[] = [
  {
    name: "skill-only",
    spec: {
      name: "golden-skill",
      description: "A skill-only plugin.",
      keywords: ["objectcore", "demo"],
      skills: [{ name: "do-thing", description: "Use when the user wants the thing done." }],
      activation: [
        { prompt: "do the thing", expect: "do-thing" },
        { prompt: "unrelated", expect: null },
      ],
    },
  },
  {
    name: "command-only",
    spec: {
      name: "golden-command",
      description: "A command-only plugin.",
      commands: [{ name: "run-it", description: "Run the thing." }],
    },
  },
  {
    name: "hooks-only",
    spec: {
      name: "golden-hooks",
      description: "A hooks-only plugin.",
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }],
        Stop: [{ hooks: [{ type: "prompt", prompt: "Did you capture a lesson?" }] }],
      },
    },
  },
  {
    name: "agent-only",
    spec: {
      name: "golden-agent",
      description: "An agent-only plugin.",
      agents: [{ name: "helper", description: "Delegate when the user needs deep help." }],
      delegation: [
        { prompt: "I need deep help", expect: "helper" },
        { prompt: "unrelated", expect: null },
      ],
    },
  },
  {
    name: "mcp-only",
    spec: {
      name: "golden-mcp",
      description: "An MCP-only plugin.",
      mcp: { "my-server": { command: "bun", args: ["${CLAUDE_PLUGIN_ROOT}/server.ts"] } },
    },
  },
  {
    name: "output-style-only",
    spec: {
      name: "golden-output-style",
      description: "An output-style-only plugin.",
      outputStyles: [{ name: "terse", description: "Be terse." }],
    },
  },
  {
    name: "settings-with-agent",
    spec: {
      name: "golden-settings",
      description: "An agent plus a settings.agent reference.",
      agents: [{ name: "main-agent", description: "Delegate when running as the main thread." }],
      settings: { agent: "main-agent" },
      delegation: [
        { prompt: "run as main", expect: "main-agent" },
        { prompt: "unrelated", expect: null },
      ],
    },
  },
  {
    name: "full-combo",
    spec: {
      name: "golden-full",
      description: "A plugin exercising every emit branch.",
      version: "1.2.3",
      author: { name: "twofoldtech-dakota" },
      license: "Apache-2.0",
      keywords: ["objectcore", "full"],
      category: "workflow",
      repository: "https://github.com/twofoldtech-dakota/objectcore",
      skills: [{ name: "main-skill", description: "Use when X.", body: "# Main Skill\n\nReal body.\n" }],
      commands: [{ name: "do-cmd", description: "Do the cmd.", body: "# /do-cmd\n\nCustom body.\n" }],
      agents: [
        {
          name: "worker",
          description: "Delegate when Y.",
          model: "claude-haiku-4-5",
          tools: ["Read", "Grep"],
          body: "# Worker\n\nReal agent body.\n",
        },
      ],
      hooks: { PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo done" }] }] },
      outputStyles: [
        { name: "styled", description: "A style.", keepCodingInstructions: true, body: "# Styled\n\nStyle body.\n" },
      ],
      settings: { agent: "worker" },
      activation: [
        { prompt: "do X", expect: "main-skill" },
        { prompt: "no", expect: null },
      ],
      delegation: [
        { prompt: "do Y", expect: "worker" },
        { prompt: "no", expect: null },
      ],
      expectEntry: { version: "1.2.3", category: "workflow" },
    },
  },
];

for (const { name, spec } of SPECS) {
  test(`golden: ${name} emits a byte-stable file tree`, async () => {
    const tree = await emittedTree(spec);
    const goldenPath = join(GOLDEN_DIR, `${name}.json`);
    const serialized = JSON.stringify(tree, null, 2) + "\n";
    if (UPDATE) {
      await mkdir(GOLDEN_DIR, { recursive: true });
      await writeFile(goldenPath, serialized, "utf8");
      return;
    }
    const golden = JSON.parse(await readFile(goldenPath, "utf8"));
    expect(tree).toEqual(golden);
  });
}
