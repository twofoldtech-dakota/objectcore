// stdio entry for the KB MCP server (`bun run kb:mcp`, and the repo-root .mcp.json
// dogfood wiring). Resolves the KB root, constructs a FileKnowledgeStore over it, and
// connects a StdioServerTransport. The store self-gates on a missing KB dir (list()
// returns [] → empty index/entries; append() mkdir-s on first write), so pointing this
// at a project without a knowledge/ dir serves an empty KB rather than crashing.
//
// KB root resolution: `--dir <path>` arg > OBJECTCORE_KB_DIR env > <cwd>/knowledge.

import { join } from "node:path";
import { FileKnowledgeStore } from "@objectcore/knowledge";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createKnowledgeServer } from "./server";

/** `--dir <path>` (highest precedence) > OBJECTCORE_KB_DIR > <cwd>/knowledge. */
function resolveKbDir(argv: string[]): string {
  const di = argv.indexOf("--dir");
  const dirArg = di !== -1 ? argv[di + 1] : undefined;
  if (dirArg) return dirArg;
  const env = process.env.OBJECTCORE_KB_DIR;
  if (env) return env;
  return join(process.cwd(), "knowledge");
}

const kbDir = resolveKbDir(process.argv.slice(2));
const store = new FileKnowledgeStore(kbDir);
const server = createKnowledgeServer(store);
const transport = new StdioServerTransport();
await server.connect(transport);

// stdout is the JSON-RPC channel — every human-facing line MUST go to stderr so it
// never corrupts the protocol stream.
console.error(`objectcore-kb MCP server ready (KB dir: ${kbDir})`);
