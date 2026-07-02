// Write-time near-duplicate detection (plan 013 WP4) — the consolidation half of the
// KB's write path (Mem0's similarity-checked ADD). A pure policy: given a candidate
// entry and the ACTIVE corpus, return the entries it near-duplicates so the CLI edges
// (kb:add, kb:curate --supersede) can REFUSE the write and point at update/supersede
// instead of growing a second copy. `--force` overrides — that escape, and the
// active-only filtering, are CLI concerns; this function is filter-agnostic and only
// compares the entries it is handed (minus `excludeIds`).
//
// The metric is cosine similarity over weighted token MULTISETS (title ×3, tags ×2,
// body ×1), normalized to [0,1]. It shares ONE tokenizer with `searchEntries` (the
// same stopword/length rules — one definition, two consumers), so "similar" means the
// same thing at write time and at query time. Pure + deterministic: no Date, no
// randomness, no locale-dependent compares — the same pair always scores identically.

import type { KnowledgeEntry } from "./types";
import { tokenize } from "./search";

export interface DuplicateMatch {
  id: string;
  /** Cosine similarity in [0,1] — 1.0 is token-identical, 0 is disjoint. */
  score: number;
  title: string;
}

/** The near-duplicate cutoff: a candidate scoring `>= DUP_THRESHOLD` against any active
 *  entry is refused. Calibrated against the live corpus (plan 013 WP4): the max all-pairs
 *  similarity among the 16 active entries is ~0.468 — the two judge-vocabulary gotchas
 *  (`a-trigger-surface-...-judge-path` × `judge-pool-distractor`); the KB-architecture
 *  decisions (`storage-is-a-port` × `kb-upgrade-zero-dep-core-mcp-seam`) sit at ~0.32.
 *  The cutoff = max-observed + ~0.1 margin (0.468 + 0.1 ≈ 0.57), so it clears every
 *  legitimate vocabulary-adjacent pair yet still trips on a genuine re-worded copy of an
 *  existing entry (a paraphrase of `index-is-a-build-artifact` scores ~0.75).
 *  Overridable per-call via `opts.threshold`. */
export const DUP_THRESHOLD = 0.57;

/** The weighted token multiset for a candidate/entry: title ×3, each tag ×2, body ×1.
 *  The map is token -> weighted count; those counts are the vector components the cosine
 *  runs over. An entry's `id` is deliberately NOT weighted here (a candidate has none),
 *  so a pair scores identically regardless of which side is the "candidate". */
function weightedVector(fields: { title: string; tags?: string[]; body: string }): Map<string, number> {
  const vec = new Map<string, number>();
  const add = (text: string, weight: number): void => {
    for (const tok of tokenize(text)) vec.set(tok, (vec.get(tok) ?? 0) + weight);
  };
  add(fields.title, 3);
  for (const tag of fields.tags ?? []) add(tag, 2);
  add(fields.body, 1);
  return vec;
}

/** Cosine similarity of two weighted multisets in [0,1]. Guards the zero vector: an
 *  empty candidate (all-stopword title + empty body) yields 0, never NaN. */
function cosine(a: Map<string, number>, b: Map<string, number>): number {
  // Dot product over the smaller map (symmetric; just fewer probes).
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [tok, wa] of small) {
    const wb = large.get(tok);
    if (wb !== undefined) dot += wa * wb;
  }
  if (dot === 0) return 0;
  let na = 0;
  for (const w of a.values()) na += w * w;
  let nb = 0;
  for (const w of b.values()) nb += w * w;
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  // Clamp to 1: a vector vs itself can round to 1.0000000000000002 (sqrt·sqrt),
  // so the documented [0,1] contract is enforced, never merely approximate.
  return Math.min(1, dot / denom);
}

/** Return the entries `candidate` near-duplicates (cosine `>= threshold`), sorted score
 *  DESC then id ASC (the deterministic tie-break). The caller passes the entries to
 *  compare against — ACTIVE-only at the CLI edges (a superseded copy is fine to
 *  resemble) — and `excludeIds` drops the entry being replaced on the supersede path (a
 *  replacement legitimately resembles what it replaces). An empty candidate vector
 *  matches nothing (never NaN). */
export function findNearDuplicates(
  candidate: { title: string; tags?: string[]; body: string },
  entries: KnowledgeEntry[],
  opts: { threshold?: number; excludeIds?: string[] } = {},
): DuplicateMatch[] {
  const threshold = opts.threshold ?? DUP_THRESHOLD;
  const exclude = new Set(opts.excludeIds ?? []);
  const candVec = weightedVector(candidate);
  if (candVec.size === 0) return [];

  const matches: DuplicateMatch[] = [];
  for (const e of entries) {
    if (exclude.has(e.id)) continue;
    const score = cosine(candVec, weightedVector(e));
    if (score >= threshold) matches.push({ id: e.id, score, title: e.title });
  }
  // score DESC, then id ASC — a plain string compare (never localeCompare) so the order
  // is identical on every platform.
  matches.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return matches;
}
