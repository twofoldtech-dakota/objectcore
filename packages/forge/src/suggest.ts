// F7 Phase 2 — the declared-improvability backlog (plan 009 Phase 2).
//
// The honest, deterministic trigger surface for the self-improvement loop. Phase 1
// is human-initiated (a person notices a refinement); Phase 2 lets the SYSTEM
// surface its own candidates — but only ones explicitly DECLARED in the generator,
// never invented. The scaffolder marks a known-suboptimal default with a
// `forge:improvable — <reason>` comment (the scaffolder analogue of the existing
// `forge:todo` stub marker); this pure scanner harvests them into a backlog that an
// orchestrator (or a human) reads before delegating `forge-improver`.
//
// Why "declared", not "learned": a LEARNED signal (do refinements actually raise eval
// pass rates? — research open question 4) is the stronger trigger, but it needs
// telemetry we don't have yet. A declared backlog is honest about what it is: a
// maintainer-or-loop-seeded worklist, deterministic and gate-safe. This module is
// TCB (it is read-only over the mutable surface) — a self-edit may not touch it.

/** The marker a `scaffold.ts` comment uses to declare a Tier-A refinement candidate. */
export const IMPROVABLE_MARKER = "forge:improvable";

/** One declared refinement candidate harvested from the generator source. */
export interface ImprovabilityCandidate {
  /** 1-based line number in the scanned source. */
  line: number;
  /** The reason text after the marker (separators stripped). */
  reason: string;
}

/** Harvest every `forge:improvable — <reason>` marker from a source string. Pure;
 *  the CLI feeds it `scaffold.ts`. Order follows source order. */
export function scanImprovable(source: string): ImprovabilityCandidate[] {
  const out: ImprovabilityCandidate[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const idx = lines[i]!.indexOf(IMPROVABLE_MARKER);
    if (idx === -1) continue;
    const reason = lines[i]!
      .slice(idx + IMPROVABLE_MARKER.length)
      .replace(/^[\s—:-]+/, "")
      .trim();
    out.push({ line: i + 1, reason });
  }
  return out;
}
