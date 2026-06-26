// The knowledge base port + domain types. ObjectCore's factory KB is a graph of
// small entries (lessons, patterns, gotchas, decisions) the build/eval loop reads
// on the way IN and writes on the way OUT — the substrate the self-improving loop
// (Reflexion/EDDOps) is assembled on top of.
//
// Storage is a PORT, not a choice — exactly like the catalog's CatalogSource/Sink:
//   - FileKnowledgeStore  (operated NOW) — git-tracked, diffable in PRs so every
//     lesson the loop writes is reviewable (hard rule #5 in spirit).
//   - DbKnowledgeStore    (later) — Turso, reusing @objectcore/registry-db, lit at
//     the same kind of trigger Stage 3 had (runtime queries / scale beyond diffable).
//   - an MCP resource server (later) is an ACCESS SEAM on top of a store (the KB's
//     equivalent of the /v1/marketplace.json route), not a storage backend.
// Building those later is a relocation, not a rewrite — the seam below never changes.

export type EntryType = "lesson" | "pattern" | "gotcha" | "decision";

export const ENTRY_TYPES: readonly EntryType[] = ["lesson", "pattern", "gotcha", "decision"];

/** A single knowledge entry. `id` is a kebab-case slug = the entry's filename stem. */
export interface KnowledgeEntry {
  id: string;
  type: EntryType;
  title: string;
  tags: string[];
  /** Optional provenance — a URL, commit, or plan reference. */
  source?: string;
  /** ISO date (YYYY-MM-DD) the entry was created. */
  created: string;
  /** Markdown body — the lesson itself. */
  body: string;
}

/** Fields a writer supplies; the store fills `id`/`created` if omitted. */
export interface KnowledgeEntryInput {
  id?: string;
  type: EntryType;
  title: string;
  tags?: string[];
  source?: string;
  created?: string;
  body: string;
}

/** The seam. Reads swap the source, writes swap the sink — exactly like the
 *  catalog's CatalogSource/CatalogSink. Every adapter (file now, DB/MCP later)
 *  implements this; nothing above it changes when storage relocates. */
export interface KnowledgeStore {
  list(): Promise<KnowledgeEntry[]>;
  get(id: string): Promise<KnowledgeEntry | null>;
  append(entry: KnowledgeEntryInput): Promise<KnowledgeEntry>;
}
