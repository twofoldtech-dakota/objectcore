// The PluginSpec is the seam between /forge's synthesis phases (grill + plan,
// done by a frontier model) and the deterministic scaffolder (cheap/code). The
// model produces a PluginSpec; scaffoldPlugin turns it into a real, gated plugin
// on disk. Everything the scaffolder needs is here — no free-form generation.

import type { ActivationCase } from "@objectcore/eval";

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
  /** Activation eval cases. REQUIRED when the plugin ships skills. */
  activation?: ActivationCase[];
  /** Optional output-eval expectations; defaults to asserting the version. */
  expectEntry?: Record<string, unknown>;
}

export interface ScaffoldResult {
  /** Absolute path of the created plugin directory. */
  dir: string;
  /** Absolute paths of every file written, in write order. */
  written: string[];
}
