// stdio entry for the KB MCP server (`bun run kb:mcp`, and the repo-root .mcp.json
// dogfood wiring). Resolves the KB root, constructs a FileKnowledgeStore over it, and
// connects a StdioServerTransport. The store self-gates on a missing KB dir (list()
// returns [] → empty index/entries; append() mkdir-s on first write), so pointing this
// at a project without a knowledge/ dir serves an empty KB rather than crashing.
//
// KB root resolution: `--dir <path>` arg > OBJECTCORE_KB_DIR env > <cwd>/knowledge.
// Usage log (kb_cite sink): `--usage-log <path>` arg > OBJECTCORE_KB_USAGE_LOG env >
// absent — and when absent, kb_cite is not registered (the sink-gated posture).

import { join } from "node:path";
import { FileKnowledgeStore } from "@objectcore/knowledge";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createKnowledgeServer, type KnowledgeMcpOptions } from "./server";

/** `--dir <path>` (highest precedence) > OBJECTCORE_KB_DIR > <cwd>/knowledge. */
function resolveKbDir(argv: string[]): string {
  const di = argv.indexOf("--dir");
  const dirArg = di !== -1 ? argv[di + 1] : undefined;
  if (dirArg) return dirArg;
  const env = process.env.OBJECTCORE_KB_DIR;
  if (env) return env;
  return join(process.cwd(), "knowledge");
}

/** `--usage-log <path>` (highest precedence) > OBJECTCORE_KB_USAGE_LOG > absent.
 *  Absent means kb_cite stays UNregistered (sink-gated). */
function resolveUsageLog(argv: string[]): string | undefined {
  const ui = argv.indexOf("--usage-log");
  const arg = ui !== -1 ? argv[ui + 1] : undefined;
  if (arg) return arg;
  const env = process.env.OBJECTCORE_KB_USAGE_LOG;
  if (env) return env;
  return undefined;
}

const argv = process.argv.slice(2);
const kbDir = resolveKbDir(argv);
const usageLogPath = resolveUsageLog(argv);
const store = new FileKnowledgeStore(kbDir);
const opts: KnowledgeMcpOptions = {};
if (usageLogPath !== undefined) opts.usageLogPath = usageLogPath;
const server = createKnowledgeServer(store, opts);
const transport = new StdioServerTransport();
await server.connect(transport);

// stdout is the JSON-RPC channel — every human-facing line MUST go to stderr so it
// never corrupts the protocol stream.
console.error(
  `objectcore-kb MCP server ready (KB dir: ${kbDir}` +
    `${usageLogPath ? `, usage log: ${usageLogPath}` : ""})`,
);
