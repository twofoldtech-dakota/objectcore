// Pure staleness policy for the knowledge base — the KB's valid-time signal
// (Zep/Graphiti's bi-temporal idea, adopted as a flat pure function per plan 013).
// NO I/O and NO Date.now: `today`, file existence, and git dates are ALL injected by
// the edge (scripts/kb-verify.ts). This mirrors the release engine's split — a pure
// policy here, the git/disk gathering at the script edge — and is DELIBERATELY kept
// out of `bun run check`/`kb:check`: CI clones are shallow, so git-dated staleness in
// the gate would be wrong (constraint #5). Curation tooling, never gate-blocking.

import type { KnowledgeEntry } from "./types";

export type Freshness = "fresh" | "stale" | "unverifiable";

/** One reference parsed out of an entry's (often composite) `source` string. */
export interface SourceRef {
  raw: string;
  kind: "path" | "url";
}

/** Parse the messy live-corpus `source` string into individual references.
 *
 *  The corpus is deliberately messy — composites joined by `;`/`,`, trailing
 *  parentheticals (`(F4)`), brace sets (`{a,b}`), URLs, and extensionless shorthand
 *  (`plans/008`). Algorithm:
 *    1. split on `;`/`,` at the TOP LEVEL — a comma INSIDE `{...}` is part of a brace
 *       set, not a separator (so `x/{a,b}.ts, y.ts` → two fragments, not four);
 *    2. per fragment: trim, take the first whitespace-delimited token, strip a
 *       trailing `(...)` parenthetical, then expand ONE level of `{a,b}`;
 *    3. classify: `url` iff it starts `http(s):`; else `path` iff it contains `/`;
 *       anything else (bare prose like `F4`) is dropped.
 *
 *  Worked example — the real composite source
 *    `plans/008 F4; packages/eval/src/{coverage,delegation}.ts, packages/forge/src/scaffold.ts`
 *  yields the 3 real file paths (coverage.ts, delegation.ts, scaffold.ts) PLUS
 *  `plans/008` as a 4th path-like ref (it contains `/`, so it is kept) = 4 path refs.
 *  `plans/008` is extensionless shorthand — assessStaleness treats its absence as
 *  "unverifiable", not "stale". */
export function parseSourceRefs(source: string | undefined): SourceRef[] {
  if (!source) return [];
  const refs: SourceRef[] = [];
  for (const fragment of splitTopLevel(source)) {
    const firstToken = fragment.trim().split(/\s+/)[0] ?? "";
    const token = stripTrailingParen(firstToken);
    if (!token) continue;
    for (const expanded of expandBraces(token)) {
      const ref = classify(expanded);
      if (ref) refs.push(ref);
    }
  }
  return refs;
}

/** Split on `;`/`,`, but never on a comma inside `{...}` (a brace set's internal
 *  comma is part of the set). A simple depth counter — nesting still splits correctly
 *  since we only EXPAND one level downstream. */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of s) {
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    if ((ch === ";" || ch === ",") && depth === 0) {
      out.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  out.push(buf);
  return out;
}

/** Strip a single trailing parenthetical like `(F4)`. The first-token step already
 *  drops a space-separated `(F4)`; this also handles the no-space `foo.ts(F4)` form. */
function stripTrailingParen(token: string): string {
  return token.replace(/\([^)]*\)$/, "");
}

/** Expand ONE level of a single `{a,b,c}` brace set: `x/{a,b}.ts` → `x/a.ts`,
 *  `x/b.ts`. No brace set → the token unchanged; only the FIRST set is expanded. */
function expandBraces(token: string): string[] {
  const m = token.match(/\{([^{}]*)\}/);
  if (!m || m.index === undefined) return [token];
  const options = m[1]!
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (!options.length) return [token.slice(0, m.index) + token.slice(m.index + m[0].length)];
  const before = token.slice(0, m.index);
  const after = token.slice(m.index + m[0].length);
  return options.map((o) => before + o + after);
}

/** Classify a cleaned token: `url` if `http(s):`, else `path` if it contains a `/`,
 *  else null (bare prose — dropped). */
function classify(token: string): SourceRef | null {
  const t = token.trim();
  if (!t) return null;
  if (/^https?:/i.test(t)) return { raw: t, kind: "url" };
  if (t.includes("/")) return { raw: t, kind: "path" };
  return null;
}

/** Disk/git evidence for one PATH ref, gathered by the edge (kb:verify). `exists` is
 *  `existsSync`; `lastModified` is `git log -1 --format=%cs` (ISO date), absent when
 *  git has no record (untracked, git unavailable, or a shallow clone). */
export interface PathEvidence {
  path: string;
  exists: boolean;
  /** ISO date (YYYY-MM-DD) of the last commit touching `path`; absent if unknown. */
  lastModified?: string;
}

export interface StalenessAssessment {
  id: string;
  freshness: Freshness;
  reason: string;
  /** The date the assessment was anchored to (verifiedAt ?? updated ?? created). */
  anchor: string;
}

/** True when a path's LAST segment carries an extension (a `.`), so a missing one is
 *  a real deleted/renamed FILE (→ stale). An extensionless ref (`plans/008`) is
 *  shorthand, not a file — its absence is not drift. */
function isExtensioned(path: string): boolean {
  const seg = path.split("/").pop() ?? path;
  return seg.includes(".");
}

/** Classify one entry as fresh/stale/unverifiable from its path evidence. PURE — the
 *  edge gathers `evidence` (existence + git dates for the entry's PATH refs; URLs are
 *  excluded upstream) and injects `today`; this never touches disk or the clock.
 *
 *  `today` is injected for purity and a future max-age rule; the v1 policy is
 *  anchor-relative only (deliberately minimal — no arbitrary max-age constant).
 *
 *  anchor = verifiedAt ?? updated ?? created. Then, in order:
 *    1. any EXTENSIONED path missing            → stale (a source file was deleted/renamed)
 *    2. any existing path modified after anchor  → stale (changed since last verified)
 *    3. ≥1 existing path, none newer             → fresh
 *    4. no path refs, or only extensionless-missing → unverifiable
 *  A `lastModified === anchor` (same-day) is NOT drift — the compare is strict `>`. */
export function assessStaleness(
  entry: KnowledgeEntry,
  evidence: PathEvidence[],
  today: string,
): StalenessAssessment {
  void today; // reserved for a future max-age rule; v1 is anchor-relative (see above)
  const anchor = entry.verifiedAt ?? entry.updated ?? entry.created;
  const id = entry.id;

  // Reasons name the deciding path(s) — ALL of them, not just the first, so a
  // composite-source entry's drift is fully visible (a curation, not a gate, signal).

  // 1) Missing EXTENSIONED source file(s) → stale (deleted/renamed out from under us).
  const missing = evidence.filter((e) => !e.exists && isExtensioned(e.path));
  if (missing.length) {
    return {
      id,
      freshness: "stale",
      reason: `source file missing: ${missing.map((e) => e.path).join(", ")}`,
      anchor,
    };
  }

  // 2) Existing source(s) changed AFTER the anchor (strict, timezone-free ISO compare).
  const changed = evidence.filter(
    (e) => e.exists && e.lastModified !== undefined && e.lastModified > anchor,
  );
  if (changed.length) {
    const dates = changed.map((e) => e.lastModified!).sort();
    const newest = dates[dates.length - 1]!;
    return {
      id,
      freshness: "stale",
      reason: `source changed after last verification: ${changed
        .map((e) => e.path)
        .join(", ")} (${newest} > ${anchor})`,
      anchor,
    };
  }

  // 3) At least one existing source, none newer than the anchor → fresh. (An existing
  //    path with no git date can't be "newer", so existence alone carries it here.)
  const present = evidence.filter((e) => e.exists);
  if (present.length) {
    return {
      id,
      freshness: "fresh",
      reason: `source present, unchanged since ${anchor}: ${present.map((e) => e.path).join(", ")}`,
      anchor,
    };
  }

  // 4) Nothing verifiable: a URL/prose entry (no path refs at all) or only
  //    extensionless shorthand that doesn't resolve (`plans/008`) — absence here is
  //    NOT drift, just an unverifiable reference.
  const reason = evidence.length
    ? `no resolvable source files (shorthand only: ${evidence.map((e) => e.path).join(", ")})`
    : `no path-like source to verify (URL or prose reference)`;
  return { id, freshness: "unverifiable", reason, anchor };
}
