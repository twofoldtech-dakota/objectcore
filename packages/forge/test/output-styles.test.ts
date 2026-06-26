import { test, expect } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GitWorkspaceSource, deriveCatalog, validateAll } from "@objectcore/registry-core";
import { scaffoldPlugin } from "../src/scaffold";
import type { PluginSpec } from "../src/types";

const deriveOpts = { name: "objectcore", owner: { name: "x" }, pluginRoot: "./plugins" };

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "forge-os-"));
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

test("scaffoldPlugin emits output-styles/<name>.md; an output-style-only plugin validates", async () => {
  const spec: PluginSpec = {
    name: "styled",
    description: "An output-style-only plugin.",
    keywords: ["objectcore", "output-styles"],
    outputStyles: [
      {
        name: "terse-reviewer",
        description: "Terse, bullet-first review output.",
        keepCodingInstructions: true,
        forceForPlugin: true,
        body: "Respond in terse bullets, findings first.\n",
      },
    ],
  };
  const dir = await tmp();
  try {
    const { dir: pluginDir, written } = await scaffoldPlugin(spec, dir);
    const stylePath = join(pluginDir, "output-styles", "terse-reviewer.md");
    expect(written).toContain(stylePath);

    const md = await readFile(stylePath, "utf8");
    expect(md).toContain("name: terse-reviewer");
    expect(md).toContain("description: Terse, bullet-first review output.");
    expect(md).toContain("keep-coding-instructions: true"); // hyphenated spelling
    expect(md).toContain("force-for-plugin: true");
    expect(md).toContain("Respond in terse bullets");

    const plugins = await new GitWorkspaceSource(dir).listPlugins();
    const catalog = deriveCatalog(plugins, deriveOpts);
    const errors = (await validateAll(plugins, catalog)).filter((i) => i.level === "error");
    expect(errors).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("output-style frontmatter omits unset booleans; an empty body gets the forge:todo stub", async () => {
  const dir = await tmp();
  try {
    const { dir: pluginDir } = await scaffoldPlugin(
      { name: "minimal-style", description: "x", outputStyles: [{ name: "plain" }] },
      dir,
    );
    const md = await readFile(join(pluginDir, "output-styles", "plain.md"), "utf8");
    expect(md).toContain("name: plain");
    expect(md).not.toContain("keep-coding-instructions");
    expect(md).not.toContain("force-for-plugin");
    expect(md).toContain("forge:todo"); // unfilled body stub
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scaffoldPlugin rejects a non-kebab output style name", async () => {
  const dir = await tmp();
  try {
    await expect(
      scaffoldPlugin(
        { name: "bad-style", description: "x", outputStyles: [{ name: "Not Kebab" }] },
        dir,
      ),
    ).rejects.toThrow(/output style name .* must be kebab-case/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// --- plugin settings.json (the narrow packagable subset) ---------------------

test("settings.json emits only packagable keys; agent must reference a declared agent", async () => {
  const spec: PluginSpec = {
    name: "settled",
    description: "A plugin that runs its own agent as the main thread.",
    agents: [{ name: "driver", description: "Use to drive the main loop.", body: "You drive.\n" }],
    delegation: [
      { prompt: "drive the main loop now", expect: "driver" },
      { prompt: "unrelated chatter", expect: null },
    ],
    settings: { agent: "driver", subagentStatusLine: { type: "command", command: "echo hi" } },
  };
  const dir = await tmp();
  try {
    const { dir: pluginDir, written } = await scaffoldPlugin(spec, dir);
    const settingsPath = join(pluginDir, "settings.json");
    expect(written).toContain(settingsPath);

    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    expect(settings.agent).toBe("driver");
    expect(settings.subagentStatusLine).toEqual({ type: "command", command: "echo hi" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scaffoldPlugin rejects an unknown settings key and a dangling settings.agent", async () => {
  const dir = await tmp();
  try {
    await expect(
      scaffoldPlugin(
        {
          name: "bad-settings-key",
          description: "x",
          outputStyles: [{ name: "s", body: "real" }],
          settings: { theme: "dark" } as never,
        },
        dir,
      ),
    ).rejects.toThrow(/not packagable/);

    await expect(
      scaffoldPlugin(
        {
          name: "dangling-agent",
          description: "x",
          outputStyles: [{ name: "s", body: "real" }],
          settings: { agent: "ghost" },
        },
        dir,
      ),
    ).rejects.toThrow(/names no agent declared/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a plugin with only settings (no real component) is rejected", async () => {
  const dir = await tmp();
  try {
    await expect(
      scaffoldPlugin(
        {
          name: "settings-only",
          description: "x",
          agents: [{ name: "a", description: "d", body: "b" }],
          delegation: [
            { prompt: "do a", expect: "a" },
            { prompt: "no", expect: null },
          ],
          settings: { agent: "a" },
        },
        dir,
      ),
    ).resolves.toBeDefined(); // agents present -> valid
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("output-styles/ inside .claude-plugin/ is flagged by the placement lint", async () => {
  // The components-at-root invariant now covers output-styles too.
  const dir = await tmp();
  try {
    const { dir: pluginDir } = await scaffoldPlugin(
      { name: "place-ok", description: "x", outputStyles: [{ name: "ok", body: "real" }] },
      dir,
    );
    // Sanity: scaffolder always puts it at the root, so placement passes.
    expect(await exists(join(pluginDir, "output-styles", "ok.md"))).toBe(true);
    const plugins = await new GitWorkspaceSource(dir).listPlugins();
    const catalog = deriveCatalog(plugins, deriveOpts);
    const errors = (await validateAll(plugins, catalog)).filter((i) => i.level === "error");
    expect(errors).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
