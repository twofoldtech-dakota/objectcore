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

/** Lifecycle state. `active` (the default — absent status) is the only state that
 *  reaches the loaded INDEX; `superseded`/`deprecated` are archived (bounded
 *  forgetting: superseding an entry reclaims budget by construction). */
export type EntryStatus = "active" | "superseded" | "deprecated";

export const ENTRY_STATUSES: readonly EntryStatus[] = ["active", "superseded", "deprecated"];

/** Where an entry came from — a human (`manual`) or the reflection loop
 *  (`reflection`). Absent = `manual`. */
export type EntryOrigin = "manual" | "reflection";

export const ENTRY_ORIGINS: readonly EntryOrigin[] = ["manual", "reflection"];

/** A single knowledge entry. `id` is a kebab-case slug = the entry's filename stem.
 *  All lifecycle fields are OPTIONAL — an entry without them is active/manual, so
 *  the existing corpus never churns. */
export interface KnowledgeEntry {
  id: string;
  type: EntryType;
  title: string;
  tags: string[];
  /** Optional provenance — a URL, commit, or plan reference. */
  source?: string;
  /** ISO date (YYYY-MM-DD) the entry was created. */
  created: string;
  /** Lifecycle state; absent = active. */
  status?: EntryStatus;
  /** Kebab id of the replacement — required iff `status === "superseded"`. */
  supersededBy?: string;
  /** ISO date of the last content/lifecycle change (store-stamped). */
  updated?: string;
  /** ISO date the entry was last confirmed still true. */
  verifiedAt?: string;
  /** Provenance of authorship; absent = manual. */
  origin?: EntryOrigin;
  /** Related entry ids (kebab). Serialized like `tags`: `links: [a, b]`. */
  links?: string[];
  /** Markdown body — the lesson itself. */
  body: string;
}

/** Fields a writer supplies; the store fills `id`/`created` if omitted. The
 *  lifecycle fields are accepted too (so kb:add can set `origin`). */
export interface KnowledgeEntryInput {
  id?: string;
  type: EntryType;
  title: string;
  tags?: string[];
  source?: string;
  created?: string;
  status?: EntryStatus;
  supersededBy?: string;
  updated?: string;
  verifiedAt?: string;
  origin?: EntryOrigin;
  links?: string[];
  body: string;
}

/** A partial edit applied by `KnowledgeStore.update`. `id`/`created` are NOT
 *  patchable (identity + provenance are immutable). A field left `undefined` is
 *  untouched; `source: ""` clears the source (mirrors append's `|| undefined`). */
export interface KnowledgeEntryPatch {
  type?: EntryType;
  title?: string;
  tags?: string[];
  source?: string;
  body?: string;
  status?: EntryStatus;
  supersededBy?: string;
  verifiedAt?: string;
  origin?: EntryOrigin;
  links?: string[];
  /** Explicit override; otherwise the store stamps `updated` on a content change. */
  updated?: string;
}

/** The seam. Reads swap the source, writes swap the sink — exactly like the
 *  catalog's CatalogSource/CatalogSink. Every adapter (file now, DB/MCP later)
 *  implements this; nothing above it changes when storage relocates. */
export interface KnowledgeStore {
  list(): Promise<KnowledgeEntry[]>;
  get(id: string): Promise<KnowledgeEntry | null>;
  append(entry: KnowledgeEntryInput): Promise<KnowledgeEntry>;
  /** Apply a partial edit. `id`/`created` are not patchable. */
  update(id: string, patch: KnowledgeEntryPatch): Promise<KnowledgeEntry>;
  /** Retire `oldId` (→ superseded, pointing at the replacement) and write a fresh
   *  replacement entry, atomically (neither lands unless BOTH round-trip). */
  supersede(
    oldId: string,
    replacement: KnowledgeEntryInput,
  ): Promise<{ superseded: KnowledgeEntry; replacement: KnowledgeEntry }>;
}
