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
