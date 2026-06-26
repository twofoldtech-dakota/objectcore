// The PluginSpec is the seam between /forge's synthesis phases (grill + plan,
// done by a frontier model) and the deterministic scaffolder (cheap/code). The
// model produces a PluginSpec; scaffoldPlugin turns it into a real, gated plugin
// on disk. Everything the scaffolder needs is here — no free-form generation.

import type { ActivationCase, DelegationCase } from "@objectcore/eval";

/** A skill or command to emit. `body` is the markdown after frontmatter; if
 *  omitted, a conforming stub is generated. */
export interface ComponentSpec {
  name: string;
  description: string;
  body?: string;
}

/** A single hook action. `type` is required; the other fields depend on the type
 *  (`command` for command actions, `prompt` for prompt actions, etc.). Extra
 *  fields pass through verbatim so the engine doesn't lag the hooks spec. */
export interface HookAction {
  type: "command" | "http" | "mcp_tool" | "prompt" | "agent";
  command?: string;
  prompt?: string;
  timeout?: number;
  [key: string]: unknown;
}

/** One matcher -> actions entry under a lifecycle event. */
export interface HookEntry {
  /** Tool/source matcher (e.g. "Bash", "Bash|Write", "*"); omit to match all. */
  matcher?: string;
  hooks: HookAction[];
}

/** Lifecycle-event -> entries. The plugin-file wrapper `{ "hooks": {...} }` is
 *  added by the scaffolder (a plugin-specific rule), NOT the author — so the spec
 *  carries just the events map. */
export type HooksSpec = Record<string, HookEntry[]>;

/** A plugin-shipped subagent (`agents/<name>.md`). `body` is the agent's system
 *  prompt. SECURITY: `hooks`, `mcpServers`, and `permissionMode` are NOT permitted
 *  in plugin agents — they are intentionally absent here and rejected at write time.
 *  Tool lists are serialized comma-separated (the YAML-array form has a spawn bug). */
export interface AgentSpec {
  name: string;
  description: string;
  /** The agent's system prompt (markdown body). */
  body?: string;
  model?: string;
  effort?: string;
  maxTurns?: number;
  tools?: string[];
  disallowedTools?: string[];
  skills?: string[];
  memory?: "user" | "project" | "local";
  background?: boolean;
  /** The only valid value is "worktree". */
  isolation?: "worktree";
}

/** The full description of a plugin to scaffold. Mirrors the manifest fields the
 *  catalog cares about, plus the components and the activation eval cases. */
export interface PluginSpec {
  name: string;
  description: string;
  version?: string;
  author?: { name: string; email?: string; url?: string };
  license?: string;
  keywords?: string[];
  category?: string;
  /** MUST be a string (a hard load error otherwise) — the scaffolder keeps it so. */
  repository?: string;
  skills?: ComponentSpec[];
  commands?: ComponentSpec[];
  /** Lifecycle hooks → emitted as `hooks/hooks.json` (engine adds the wrapper). */
  hooks?: HooksSpec;
  /** Subagents → emitted as `agents/<name>.md` (forbidden fields rejected). */
  agents?: AgentSpec[];
  /** Activation eval cases. REQUIRED when the plugin ships skills. */
  activation?: ActivationCase[];
  /** Delegation eval cases. REQUIRED when the plugin ships agents — every agent
   *  must have a positive case (the agent analogue of the skill activation rule). */
  delegation?: DelegationCase[];
  /** Optional output-eval expectations; defaults to asserting the version. */
  expectEntry?: Record<string, unknown>;
}

export interface ScaffoldResult {
  /** Absolute path of the created plugin directory. */
  dir: string;
  /** Absolute paths of every file written, in write order. */
  written: string[];
}
