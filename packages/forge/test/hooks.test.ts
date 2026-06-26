import { test, expect } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitWorkspaceSource, deriveCatalog, validateAll } from "@objectcore/registry-core";
import { scaffoldPlugin } from "../src/scaffold";
import type { PluginSpec } from "../src/types";

const deriveOpts = { name: "objectcore", owner: { name: "x" }, pluginRoot: "./plugins" };

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "forge-hooks-"));
}

test("scaffoldPlugin emits a hooks-only plugin with the { hooks: ... } wrapper, and it validates", async () => {
  const spec: PluginSpec = {
    name: "hooked",
    description: "A hooks-only plugin.",
    keywords: ["objectcore", "hooks"],
    hooks: {
      SessionStart: [
        { matcher: "startup", hooks: [{ type: "command", command: "echo hi", timeout: 5 }] },
      ],
      Stop: [{ matcher: "*", hooks: [{ type: "prompt", prompt: "capture a lesson?" }] }],
    },
  };
  const dir = await tmp();
  try {
    const { dir: pluginDir, written } = await scaffoldPlugin(spec, dir);
    expect(written.some((w) => w.endsWith(join("hooks", "hooks.json")))).toBe(true);

    const hooks = JSON.parse(await readFile(join(pluginDir, "hooks", "hooks.json"), "utf8"));
    // Plugin-file rule: events live under a top-level "hooks" wrapper.
    expect(hooks.hooks.SessionStart[0].hooks[0].type).toBe("command");
    expect(hooks.hooks.Stop[0].hooks[0].type).toBe("prompt");

    // A hooks-only plugin (no skills/commands) is a valid catalog entry.
    const plugins = await new GitWorkspaceSource(dir).listPlugins();
    const catalog = deriveCatalog(plugins, deriveOpts);
    const errors = (await validateAll(plugins, catalog)).filter((i) => i.level === "error");
    expect(errors).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scaffoldPlugin rejects an unknown hook event", async () => {
  const dir = await tmp();
  try {
    await expect(
      scaffoldPlugin(
        { name: "bad-event", description: "x", hooks: { SesionStart: [{ hooks: [{ type: "command", command: "x" }] }] } },
        dir,
      ),
    ).rejects.toThrow(/unknown hook event/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scaffoldPlugin rejects an invalid hook action type", async () => {
  const dir = await tmp();
  try {
    await expect(
      scaffoldPlugin(
        { name: "bad-action", description: "x", hooks: { Stop: [{ hooks: [{ type: "shell" as never, command: "x" }] }] } },
        dir,
      ),
    ).rejects.toThrow(/invalid hook action type/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scaffoldPlugin rejects a command hook missing its command", async () => {
  const dir = await tmp();
  try {
    await expect(
      scaffoldPlugin(
        { name: "no-cmd", description: "x", hooks: { Stop: [{ hooks: [{ type: "command" }] }] } },
        dir,
      ),
    ).rejects.toThrow(/needs a `command`/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
