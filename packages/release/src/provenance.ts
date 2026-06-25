// The provenance gate. AGENTS.md: "Treat every MCP-bundling plugin as a managed
// credential. Block publish without provenance." An MCP server is arbitrary code
// the host runs with the user's credentials, so a plugin that ships one must not be
// published without an attestation. This is the pure manifest-level predicate; the
// publish script also scans for an `.mcp.json` at the plugin root (a plugin can
// bundle MCP without declaring the manifest override).

import type { PluginManifest } from "@objectcore/registry-core";

/** True if the manifest itself declares MCP servers (the `mcpServers` override). */
export function requiresProvenance(manifest: PluginManifest): boolean {
  return Boolean((manifest as { mcpServers?: unknown }).mcpServers);
}

/** File names that mean "this plugin bundles an MCP server" when present at root. */
export const MCP_CONFIG_FILES = [".mcp.json", "mcp.json"] as const;
