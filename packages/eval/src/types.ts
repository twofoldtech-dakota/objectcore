// ObjectCore eval-harness domain types.
//
// Two layers, mirroring the factory doctrine in CONTEXT.md / AGENTS.md:
//  - OUTPUT evals: deterministic checks on the derived artifact (does the catalog
//    entry match what the plugin intends?). Code decides pass/fail; no model.
//  - ACTIVATION evals: the non-deterministic gate. Given a skill's TRIGGER SURFACE
//    (name + description) and a prompt, does the skill fire? A Judge (LLM) routes;
//    we score against the spec. "A skill that never fires is worse than one that
//    fails to parse" — this layer is what enforces that.

/** A skill or command's trigger surface: the metadata a router sees. */
export interface TriggerSurface {
  /** Namespaced id, e.g. "plugin-forge:writing-great-skills". */
  id: string;
  /** Bare component name, e.g. "writing-great-skills". */
  name: string;
  kind: "skill" | "command";
  /** Owning plugin's manifest name. */
  plugin: string;
  /** The description line from frontmatter — the load-bearing half of the surface. */
  description: string;
}

/** One activation case: a prompt and the skill expected to fire (or null for none). */
export interface ActivationCase {
  prompt: string;
  /** Expected skill `name` to fire, or null when no skill should activate. */
  expect: string | null;
  /** Optional human note explaining why (confusability negatives, etc.). */
  note?: string;
}

/** Per-plugin activation spec, read from `<plugin>/evals/activation.json`. */
export interface ActivationSpec {
  cases: ActivationCase[];
}

/** Per-plugin output expectations, read from `<plugin>/evals/output.json`. */
export interface OutputSpec {
  /** A subset of the expected derived catalog entry; each key is asserted equal. */
  expectEntry?: Record<string, unknown>;
}

/** A Judge's verdict for one routing decision. */
export interface RouteDecision {
  /** The skill `name` the judge believes fires, or null for none. */
  skill: string | null;
  /** 0..1 — the judge's confidence in this routing. */
  confidence: number;
  reason: string;
}

/** The Judge port. MockJudge (tests) and AnthropicJudge (real) implement it. */
export interface Judge {
  /** Given the candidate surfaces and a prompt, decide which skill fires. */
  route(prompt: string, candidates: TriggerSurface[]): Promise<RouteDecision>;
}

/** One eval outcome — output check, coverage check, or activation case. */
export interface EvalResult {
  suite: "output" | "coverage" | "activation";
  /** Stable identifier for the check/case. */
  name: string;
  plugin?: string;
  passed: boolean;
  /** Errors block the gate; warnings are reported but don't fail it. */
  level: "error" | "warning";
  detail: string;
}

/** Aggregate of a run, ready to print and to gate on. */
export interface EvalReport {
  results: EvalResult[];
  /** Suites that were not run, with the reason (no silent caps). */
  skipped: string[];
  passed: number;
  failed: number;
  warnings: number;
}
