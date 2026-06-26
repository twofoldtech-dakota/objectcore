import { test, expect } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { GitWorkspaceSource, deriveCatalog, validateAll } from "@objectcore/registry-core";
import { MCP_CONFIG_FILES, requiresProvenance } from "@objectcore/release";
import { scaffoldPlugin } from "../src/scaffold";
import type { PluginSpec } from "../src/types";

const deriveOpts = { name: "objectcore", owner: { name: "x" }, pluginRoot: "./plugins" };

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "forge-mcp-"));
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

test("scaffoldPlugin emits a stdio .mcp.json at the plugin ROOT; an MCP-only plugin validates", async () => {
  const spec: PluginSpec = {
    name: "mcped",
    description: "An MCP-only plugin.",
    keywords: ["objectcore", "mcp"],
    mcp: {
      "kb-server": {
        command: "bun",
        args: ["${CLAUDE_PLUGIN_ROOT}/mcp/server.ts"],
        env: { OBJECTCORE_KB: "${CLAUDE_PLUGIN_ROOT}/knowledge" },
      },
    },
  };
  const dir = await tmp();
  try {
    const { dir: pluginDir, written } = await scaffoldPlugin(spec, dir);

    // Emitted at the ROOT, not under .claude-plugin/ or a component dir.
    const mcpPath = join(pluginDir, ".mcp.json");
    expect(written).toContain(mcpPath);
    expect(await exists(mcpPath)).toBe(true);

    const cfg = JSON.parse(await readFile(mcpPath, "utf8"));
    expect(cfg.mcpServers["kb-server"].command).toBe("bun");
    // ${CLAUDE_PLUGIN_ROOT} is preserved verbatim (resolves at install time).
    expect(cfg.mcpServers["kb-server"].args[0]).toContain("${CLAUDE_PLUGIN_ROOT}");
    // Server objects live in .mcp.json, NOT in the manifest.
    const manifest = JSON.parse(await readFile(join(pluginDir, ".claude-plugin", "plugin.json"), "utf8"));
    expect(manifest.mcpServers).toBeUndefined();

    const plugins = await new GitWorkspaceSource(dir).listPlugins();
    const catalog = deriveCatalog(plugins, deriveOpts);
    const errors = (await validateAll(plugins, catalog)).filter((i) => i.level === "error");
    expect(errors).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the forge-emitted .mcp.json is exactly what the publish-time provenance gate scans for", async () => {
  const dir = await tmp();
  try {
    const { dir: pluginDir, written } = await scaffoldPlugin(
      {
        name: "mcp-prov",
        description: "x",
        mcp: { remote: { type: "http", url: "https://mcp.example.com" } },
      },
      dir,
    );
    const emitted = written.find((w) => w.endsWith(".mcp.json"))!;
    // The gate (`hasMcpConfig`) iterates MCP_CONFIG_FILES at the plugin root — the
    // forge output must be one of those exact names or the bundle would slip past.
    expect((MCP_CONFIG_FILES as readonly string[]).includes(basename(emitted))).toBe(true);

    // Detection is FILE-based for forge output: the manifest has no mcpServers
    // override, so requiresProvenance alone is false — the file scan is what catches it.
    const plugins = await new GitWorkspaceSource(dir).listPlugins();
    expect(requiresProvenance(plugins[0]!.manifest)).toBe(false);
    expect(await exists(join(pluginDir, ".mcp.json"))).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scaffoldPlugin emits a remote (http) server without command/args", async () => {
  const dir = await tmp();
  try {
    const { dir: pluginDir } = await scaffoldPlugin(
      {
        name: "remote-mcp",
        description: "x",
        mcp: { api: { type: "sse", url: "https://example.com/sse", headers: { "X-Key": "${API_KEY}" } } },
      },
      dir,
    );
    const cfg = JSON.parse(await readFile(join(pluginDir, ".mcp.json"), "utf8"));
    expect(cfg.mcpServers.api.type).toBe("sse");
    expect(cfg.mcpServers.api.url).toBe("https://example.com/sse");
    expect(cfg.mcpServers.api.command).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a plugin can be MCP-only (no skill/command/agent/hooks)", async () => {
  const dir = await tmp();
  try {
    await expect(
      scaffoldPlugin(
        { name: "only-mcp", description: "x", mcp: { s: { command: "node" } } },
        dir,
      ),
    ).resolves.toBeDefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scaffoldPlugin rejects malformed MCP specs before writing", async () => {
  const cases: Array<[string, PluginSpec, RegExp]> = [
    ["stdio without command", { name: "m1", description: "x", mcp: { s: { args: ["x"] } } }, /needs a `command`/],
    ["http without url", { name: "m2", description: "x", mcp: { s: { type: "http" } } }, /needs a `url`/],
    ["stdio with url", { name: "m3", description: "x", mcp: { s: { command: "bun", url: "http://x" } } }, /must not set `url`/],
    ["http with command", { name: "m4", description: "x", mcp: { s: { type: "http", url: "http://x", command: "bun" } } }, /must not set `command`/],
    ["bad transport", { name: "m5", description: "x", mcp: { s: { type: "ws" as never, url: "x" } } }, /invalid type/],
    ["bad server name", { name: "m6", description: "x", mcp: { "bad name": { command: "bun" } } }, /server name/],
    ["empty mcp", { name: "m7", description: "x", mcp: {} }, /at least one component/],
  ];
  for (const [label, spec, re] of cases) {
    const dir = await tmp();
    try {
      await expect(scaffoldPlugin(spec, dir), label).rejects.toThrow(re);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});
