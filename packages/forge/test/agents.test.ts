import { test, expect } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitWorkspaceSource, deriveCatalog, validateAll } from "@objectcore/registry-core";
import { scaffoldPlugin } from "../src/scaffold";
import type { PluginSpec } from "../src/types";

const deriveOpts = { name: "objectcore", owner: { name: "x" }, pluginRoot: "./plugins" };

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "forge-agents-"));
}

test("scaffoldPlugin emits an agents-only plugin; tools serialize comma-separated; it validates", async () => {
  const spec: PluginSpec = {
    name: "agented",
    description: "An agents-only plugin.",
    keywords: ["objectcore", "agents"],
    agents: [
      {
        name: "reviewer",
        description: "Use when reviewing a diff.",
        model: "sonnet",
        tools: ["Read", "Grep", "Bash"],
        body: "You review diffs.\n",
      },
    ],
  };
  const dir = await tmp();
  try {
    const { dir: pluginDir, written } = await scaffoldPlugin(spec, dir);
    expect(written.some((w) => w.endsWith(join("agents", "reviewer.md")))).toBe(true);

    const md = await readFile(join(pluginDir, "agents", "reviewer.md"), "utf8");
    expect(md).toContain("name: reviewer");
    expect(md).toContain("tools: Read, Grep, Bash"); // comma-separated, not [..]
    expect(md).not.toContain("[Read");

    const plugins = await new GitWorkspaceSource(dir).listPlugins();
    const catalog = deriveCatalog(plugins, deriveOpts);
    const errors = (await validateAll(plugins, catalog)).filter((i) => i.level === "error");
    expect(errors).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scaffoldPlugin rejects a forbidden agent field (security)", async () => {
  const dir = await tmp();
  try {
    await expect(
      scaffoldPlugin(
        {
          name: "unsafe-agent",
          description: "x",
          agents: [{ name: "a", description: "d", mcpServers: {} } as never],
        },
        dir,
      ),
    ).rejects.toThrow(/not allowed in a plugin-shipped agent/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scaffoldPlugin rejects an invalid isolation value", async () => {
  const dir = await tmp();
  try {
    await expect(
      scaffoldPlugin(
        {
          name: "bad-iso",
          description: "x",
          agents: [{ name: "a", description: "d", isolation: "vm" as never }],
        },
        dir,
      ),
    ).rejects.toThrow(/isolation/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a scaffolded agent with no body gets the visible forge:todo stub marker", async () => {
  const dir = await tmp();
  try {
    const { dir: pluginDir } = await scaffoldPlugin(
      { name: "stub-agent", description: "x", agents: [{ name: "a", description: "Use for X." }] },
      dir,
    );
    const md = await readFile(join(pluginDir, "agents", "a.md"), "utf8");
    expect(md).toContain("forge:todo");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
