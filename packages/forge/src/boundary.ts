// F7 Phase 0 — the self-edit boundary (plan 009, Pillar 1).
//
// The safe gating boundary for letting forge improve its OWN code: an automated
// self-edit (the future `forge-improver` proposer) may touch ONLY the generative
// logic that turns an already-validated PluginSpec into bytes. It may NEVER touch
// the gate that judges that output — the eval harness, the derive/validate seam,
// the spec contract, or the meta-eval corpus — because a self-improving system
// that can edit its own evaluator will Goodhart it.
//
// SAFETY MODEL: enforcement is an ALLOWLIST (default-deny). Only paths in
// MUTABLE_SURFACE pass; everything else is rejected — so safety does NOT depend on
// TCB_SURFACE being exhaustive. TCB_SURFACE exists only to turn a generic "outside
// the mutable surface" rejection into a precise "this is the protected gate"
// reason. Forgetting to list a sensitive path cannot leak: it still rejects.
//
// Pure (no I/O) so it is trivially testable and reusable; scripts/check-self-edit-
// boundary.ts is the thin CLI edge that feeds it `git diff --name-only`.

/** Which trust zone a changed path falls in. */
export type Zone = "mutable" | "tcb" | "other";

/** The ONLY paths an automated forge self-edit may touch: the generative logic in
 *  the scaffolder (body emitters + emit sequence). Deliberately narrow — widening
 *  this is a human decision (plan 009, Tier A vs Tier B). Repo-relative, forward
 *  slashes; a trailing "/" means "this dir and everything under it". */
export const MUTABLE_SURFACE: readonly string[] = ["packages/forge/src/scaffold.ts"];

/** The trusted computing base. The proposer is forbidden to edit any of these.
 *  Used only for diagnostics (see SAFETY MODEL above) — enforcement is the
 *  allowlist, not this denylist. */
export const TCB_SURFACE: readonly { prefix: string; reason: string }[] = [
  { prefix: "packages/eval/", reason: "the eval gate — the optimizer must not edit its own evaluator" },
  { prefix: "scripts/eval.ts", reason: "the eval gate runner" },
  { prefix: "scripts/check-catalog.ts", reason: "the catalog-sync gate" },
  { prefix: "packages/registry-core/", reason: "the derive/validate seam + validation floor" },
  { prefix: "packages/forge/src/types.ts", reason: "the PluginSpec contract — expanding it is a human (Tier B) decision" },
  { prefix: "packages/forge/src/improve.ts", reason: "the admission pipeline — the optimizer must not edit what decides its own admission" },
  { prefix: "scripts/forge-improve.ts", reason: "the admission pipeline CLI" },
  { prefix: "packages/forge/src/suggest.ts", reason: "the improvability backlog scanner — read-only over the mutable surface" },
  { prefix: "scripts/forge-suggest.ts", reason: "the improvability backlog CLI" },
  { prefix: "packages/forge/test/", reason: "the meta-eval corpus — the golden snapshots ARE the definition of correct" },
  { prefix: "objectcore.config.json", reason: "marketplace identity" },
  { prefix: ".github/", reason: "CI — the gate's enforcement point" },
  { prefix: "packages/forge/src/boundary.ts", reason: "the boundary enforcer itself — the optimizer must not move its own fence" },
  { prefix: "scripts/check-self-edit-boundary.ts", reason: "the boundary enforcer CLI" },
];

/** A path the proposer was not allowed to touch, with why. */
export interface BoundaryViolation {
  path: string;
  zone: Exclude<Zone, "mutable">;
  reason: string;
}

/** Normalize a path the way `git diff --name-only` + our surfaces expect:
 *  backslashes → forward slashes (Windows), strip a leading "./". */
function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function matches(path: string, entry: string): boolean {
  return entry.endsWith("/") ? path.startsWith(entry) : path === entry;
}

/** Classify a single changed path. Mutable wins over TCB if both ever matched
 *  (they don't today) — the allowlist is authoritative. */
export function classifyPath(path: string): Zone {
  const p = normalize(path);
  if (MUTABLE_SURFACE.some((m) => matches(p, m))) return "mutable";
  if (TCB_SURFACE.some((t) => matches(p, t.prefix))) return "tcb";
  return "other";
}

/** Return every changed path that is NOT in the mutable surface, with a reason.
 *  An empty result means the proposed diff is admissible (boundary-wise); the
 *  eval contract (plan 009 Pillar 2) is a separate, later check. */
export function findBoundaryViolations(paths: string[]): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  for (const raw of paths) {
    const p = normalize(raw);
    const zone = classifyPath(p);
    if (zone === "mutable") continue;
    const reason =
      zone === "tcb"
        ? TCB_SURFACE.find((t) => matches(p, t.prefix))!.reason
        : "outside the mutable surface (only packages/forge/src/scaffold.ts is self-editable)";
    violations.push({ path: p, zone, reason });
  }
  return violations;
}

/** Throwing convenience for callers that want a hard stop (the CLI prints instead). */
export function assertWithinMutableSurface(paths: string[]): void {
  const violations = findBoundaryViolations(paths);
  if (violations.length) {
    const lines = violations.map((v) => `  ✗ ${v.path} [${v.zone}] — ${v.reason}`);
    throw new Error(
      `self-edit boundary violated: ${violations.length} path(s) outside the mutable surface\n${lines.join("\n")}`,
    );
  }
}
