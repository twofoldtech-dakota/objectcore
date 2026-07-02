// Deterministic, zero-dep lexical retrieval over KB entries (plan 013 WP3) — the
// richer sibling of registry-core's `searchCatalog` (a pure filter behind the frozen
// catalog seam). `searchEntries` is a pure scorer behind the `KnowledgeStore` port:
// the SAME corpus + the SAME query MUST rank identically on every run and every
// platform. That determinism is load-bearing — it is exactly what lets the retrieval
// evals (knowledge/evals/retrieval.json) run OFFLINE inside `bun run check`. A keyed
// or embedding retriever would make the gate non-deterministic; the semantic upgrade
// is an adapter behind THIS API (a Judge-port reranker or an embedding store — see the
// `kb-upgrade-zero-dep-core-mcp-seam` decision), a relocation, not a rewrite.
//
// No randomness, no Date, no locale-dependent compares (plain `<`/`>` on ids, never
// localeCompare) — every source of platform variance is deliberately excluded.

import type { EntryType, KnowledgeEntry } from "./types";
import { isActive } from "./render";

/** ~30-word English stopword set — tokens that carry no retrieval signal at this
 *  curated scale. A module constant so the tokenizer (and any future caller) share one
 *  definition. Query tokens are stopword-filtered too, so a stopword sitting in an
 *  entry field can never match a query. */
const STOPWORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "to", "of", "in",
  "on", "at", "for", "with", "and", "or", "not", "no", "it", "its", "this",
  "that", "what", "whats", "how", "do", "does", "why", "when", "i", "you", "we",
  "my",
]);

/** Lowercase, split on non-alphanumeric runs, then drop stopwords and length-<2
 *  tokens. Plain ASCII lowercase + class split — no locale-dependent operations — so
 *  the token stream is byte-identical on every platform. A kebab id splits on its
 *  hyphens here (they are non-alphanumeric), so `tokenize(id)` == "split the id". */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const tok of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (tok.length < 2) continue;
    if (STOPWORDS.has(tok)) continue;
    out.push(tok);
  }
  return out;
}

export interface SearchOptions {
  /** Max hits returned (default 5). */
  k?: number;
  /** Restrict the pool to one entry type BEFORE df/N are computed. */
  type?: EntryType;
  /** Restrict the pool to entries carrying this exact tag BEFORE df/N are computed. */
  tag?: string;
  /** Include archived (superseded/deprecated) entries. Default: active-only. */
  includeArchived?: boolean;
}

export interface SearchHit {
  id: string;
  score: number;
  entry: KnowledgeEntry;
}

/** The per-entry weighted token bag: title ×3, each tag ×2, id ×2, body ×1. The map is
 *  token -> weighted count (wtf), used for BOTH the saturated tf and (via `.has`) df. */
function weightedBag(e: KnowledgeEntry): Map<string, number> {
  const bag = new Map<string, number>();
  const add = (text: string, weight: number): void => {
    for (const tok of tokenize(text)) bag.set(tok, (bag.get(tok) ?? 0) + weight);
  };
  add(e.title, 3);
  for (const tag of e.tags) add(tag, 2);
  add(e.id, 2);
  add(e.body, 1);
  return bag;
}

/** Rank entries against a free-text query. Pure + deterministic (see the file header).
 *
 *  Scoring, per UNIQUE query token t:
 *    idf(t)   = ln(1 + (N - df + 0.5) / (df + 0.5))     (BM25-style; always > 0 here)
 *    satTf(t) = wtf / (wtf + 1)                          (weighted tf, saturated)
 *    score(e) = Σ idf(t) × satTf(t)
 *  where N = the FILTERED pool size and df = pooled entries containing t in ANY field.
 *
 *  Hits require score > 0; sorted score DESC then id ASC (the deterministic tie-break). */
export function searchEntries(
  entries: KnowledgeEntry[],
  query: string,
  opts: SearchOptions = {},
): SearchHit[] {
  const k = opts.k ?? 5;

  // The pool: status (active unless includeArchived), then type, then tag — ALL applied
  // BEFORE df/N so the IDF reflects only the corpus actually being searched.
  let pool = opts.includeArchived ? entries : entries.filter(isActive);
  if (opts.type) pool = pool.filter((e) => e.type === opts.type);
  if (opts.tag) pool = pool.filter((e) => e.tags.includes(opts.tag as string));

  const queryTokens = [...new Set(tokenize(query))];
  if (!queryTokens.length || !pool.length) return [];

  // One weighted bag per pooled entry, reused for df AND tf.
  const bags = pool.map(weightedBag);
  const N = pool.length;

  // df per unique query token = pooled entries whose bag contains it (any field).
  const idf = new Map<string, number>();
  for (const t of queryTokens) {
    let df = 0;
    for (const bag of bags) if (bag.has(t)) df++;
    idf.set(t, Math.log(1 + (N - df + 0.5) / (df + 0.5)));
  }

  const hits: SearchHit[] = [];
  for (let i = 0; i < pool.length; i++) {
    const bag = bags[i] as Map<string, number>;
    const entry = pool[i] as KnowledgeEntry;
    let score = 0;
    for (const t of queryTokens) {
      const wtf = bag.get(t) ?? 0;
      if (wtf > 0) score += (idf.get(t) as number) * (wtf / (wtf + 1));
    }
    if (score > 0) hits.push({ id: entry.id, score, entry });
  }

  // score DESC, then id ASC — a plain string compare (never localeCompare) so the
  // ranking is identical on every platform. Then take the top k.
  hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return hits.slice(0, k);
}

// --- Retrieval evals (the offline, gate-safe half) ---------------------------------

export interface RetrievalCase {
  query: string;
  /** The entry id the top hit must equal, or `null` to require ZERO hits. */
  expectTop: string | null;
  note?: string;
}

export interface RetrievalCaseResult {
  query: string;
  expectTop: string | null;
  actual: string | null;
  ok: boolean;
}

/** Run retrieval eval cases against a corpus — the pure core of `kb:check`'s retrieval
 *  block (kb-check just reports the mismatches). `expectTop: "<id>"` → the top-1 hit id
 *  must equal it; `expectTop: null` → the query must return zero hits. Deterministic
 *  (searchEntries is), so this is safe to run in CI. Cases are scored with the default
 *  options (active-only, k=5), matching how a working agent would actually query. */
export function runRetrievalCases(
  entries: KnowledgeEntry[],
  cases: RetrievalCase[],
): RetrievalCaseResult[] {
  return cases.map((c) => {
    const hits = searchEntries(entries, c.query);
    const actual = hits.length ? (hits[0] as SearchHit).id : null;
    const ok = c.expectTop === null ? actual === null : actual === c.expectTop;
    return { query: c.query, expectTop: c.expectTop, actual, ok };
  });
}
