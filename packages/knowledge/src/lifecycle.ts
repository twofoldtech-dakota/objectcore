// Cross-entry integrity for the knowledge graph — the checks that need the WHOLE
// corpus, not one file (parseEntry already enforces every per-entry rule locally).
// Pure: entries in, a list of human-readable error strings out (empty = clean).
// `kb:check` runs this after its parse/sync/budget assertions.

import type { KnowledgeEntry } from "./types";

/** Validate the entry graph: every `supersededBy`/`links` target exists, no entry
 *  links to itself, and no `supersededBy` chain forms a cycle (self-reference,
 *  2-cycle, or longer). Returns one error string per problem (deduped). */
export function checkLifecycle(entries: KnowledgeEntry[]): string[] {
  const errors: string[] = [];
  const byId = new Map(entries.map((e) => [e.id, e]));

  for (const e of entries) {
    if (e.links) {
      for (const l of e.links) {
        if (l === e.id) errors.push(`entry "${e.id}" links to itself`);
        else if (!byId.has(l)) errors.push(`entry "${e.id}" links to missing entry "${l}"`);
      }
    }
    if (e.supersededBy && !byId.has(e.supersededBy)) {
      errors.push(`entry "${e.id}" is superseded by missing entry "${e.supersededBy}"`);
    }
  }

  // Cycle detection over supersededBy chains — a visited-set walk from each entry.
  // A dangling target ends the walk (undefined next), so it never reads as a cycle.
  for (const start of entries) {
    if (!start.supersededBy) continue;
    const seen = new Set<string>([start.id]);
    let cur: KnowledgeEntry | undefined = start;
    while (cur && cur.supersededBy) {
      const nextId: string = cur.supersededBy;
      if (seen.has(nextId)) {
        errors.push(`supersededBy cycle detected starting at entry "${start.id}"`);
        break;
      }
      seen.add(nextId);
      cur = byId.get(nextId);
    }
  }

  return [...new Set(errors)];
}
