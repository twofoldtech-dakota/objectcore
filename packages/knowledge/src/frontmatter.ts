// Hand-rolled, zero-dep parse/serialize for a knowledge entry's file form
// (frontmatter + markdown body). Intentionally strict and specific to the entry
// shape — same reasoning as registry-core/schema.ts hand-rolling its checks: keep
// the package dependency-free and the format auditable.

import type { EntryOrigin, EntryStatus, EntryType, KnowledgeEntry } from "./types";
import { ENTRY_ORIGINS, ENTRY_STATUSES, ENTRY_TYPES } from "./types";

const DELIM = "---";

/** Every frontmatter key the format knows. An unknown key is a parse ERROR (not
 *  silently ignored) — `statu: superseded` would otherwise read as active, a
 *  silent typo hazard. */
const KNOWN_KEYS: ReadonlySet<string> = new Set([
  "id",
  "type",
  "title",
  "tags",
  "source",
  "created",
  "status",
  "supersededBy",
  "updated",
  "verifiedAt",
  "origin",
  "links",
]);

/** Mirrored from registry-core's kebab rule (ids/links are slugs, like plugin names). */
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** ISO calendar date, the on-disk shape for `created`/`updated`/`verifiedAt`. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse an entry file into a KnowledgeEntry. `id` comes from the filename, not
 *  the frontmatter, so the two can't drift. Throws on a malformed entry. */
export function parseEntry(id: string, text: string): KnowledgeEntry {
  const norm = text.replace(/\r\n/g, "\n");
  if (!norm.startsWith(DELIM + "\n")) throw new Error(`entry "${id}": missing frontmatter`);
  const end = norm.indexOf("\n" + DELIM, DELIM.length);
  if (end === -1) throw new Error(`entry "${id}": unterminated frontmatter`);

  const fm = norm.slice(DELIM.length + 1, end + 1);
  const body = norm.slice(end + 1 + DELIM.length + 1).replace(/^\n/, "");

  const fields: Record<string, string> = {};
  for (const line of fm.split("\n")) {
    if (!line.trim()) continue;
    const i = line.indexOf(":");
    if (i === -1) throw new Error(`entry "${id}": bad frontmatter line "${line}"`);
    const key = line.slice(0, i).trim();
    if (!KNOWN_KEYS.has(key)) throw new Error(`entry "${id}": unknown frontmatter key "${key}"`);
    fields[key] = line.slice(i + 1).trim();
  }

  const type = fields.type as EntryType;
  if (!ENTRY_TYPES.includes(type)) throw new Error(`entry "${id}": invalid type "${fields.type}"`);
  if (!fields.title) throw new Error(`entry "${id}": missing title`);
  if (!fields.created) throw new Error(`entry "${id}": missing created`);

  const entry: KnowledgeEntry = {
    id,
    type,
    title: fields.title,
    tags: parseTags(fields.tags ?? ""),
    source: fields.source || undefined,
    created: fields.created,
    body: body.trimEnd() + "\n",
  };

  // --- Lifecycle fields (all optional; validated per-field) ---
  const status = fields.status || undefined;
  if (status && !ENTRY_STATUSES.includes(status as EntryStatus)) {
    throw new Error(`entry "${id}": invalid status "${status}"`);
  }
  const origin = fields.origin || undefined;
  if (origin && !ENTRY_ORIGINS.includes(origin as EntryOrigin)) {
    throw new Error(`entry "${id}": invalid origin "${origin}"`);
  }
  if (fields.updated && !ISO_DATE.test(fields.updated)) {
    throw new Error(`entry "${id}": invalid updated "${fields.updated}" (want YYYY-MM-DD)`);
  }
  if (fields.verifiedAt && !ISO_DATE.test(fields.verifiedAt)) {
    throw new Error(`entry "${id}": invalid verifiedAt "${fields.verifiedAt}" (want YYYY-MM-DD)`);
  }
  const supersededBy = fields.supersededBy || undefined;
  if (supersededBy && !KEBAB.test(supersededBy)) {
    throw new Error(`entry "${id}": supersededBy "${supersededBy}" must be kebab-case`);
  }
  // Local pairing rule (both directions) — enforced HERE so the store's round-trip
  // guard automatically rejects any update that would break it.
  if (status === "superseded" && !supersededBy) {
    throw new Error(`entry "${id}": status "superseded" requires supersededBy`);
  }
  if (supersededBy && status !== "superseded") {
    throw new Error(`entry "${id}": supersededBy requires status "superseded"`);
  }
  const links = parseTags(fields.links ?? "");
  for (const l of links) {
    if (!KEBAB.test(l)) throw new Error(`entry "${id}": link "${l}" must be kebab-case`);
  }

  if (status) entry.status = status as EntryStatus;
  if (supersededBy) entry.supersededBy = supersededBy;
  if (fields.updated) entry.updated = fields.updated;
  if (fields.verifiedAt) entry.verifiedAt = fields.verifiedAt;
  if (origin) entry.origin = origin as EntryOrigin;
  if (links.length) entry.links = links;

  return entry;
}

function parseTags(raw: string): string[] {
  const t = raw.trim();
  if (!t) return [];
  return t
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Reject values that would break the one-line frontmatter format. The KB must
 *  never be brickable by one bad append: a newline here would emit a file every
 *  later parseEntry (kb:add, kb:index, kb:check) chokes on. */
function fmValue(field: string, v: string): string {
  if (/[\n\r]/.test(v)) {
    throw new Error(`entry field \`${field}\` must be single-line (it is emitted as frontmatter): ${JSON.stringify(v)}`);
  }
  return v;
}

/** A tag must survive parseTags: no list delimiters, no newlines, no trim drift. */
function fmTag(t: string): string {
  if (/[\n\r,\[\]]/.test(t) || t.trim() !== t || !t) {
    throw new Error(`tag ${JSON.stringify(t)} would break the frontmatter tag list (no ',', '[', ']', newlines, or leading/trailing whitespace)`);
  }
  return t;
}

/** A link is a tag that must also be a kebab id (parseEntry enforces the same). */
function fmLink(l: string): string {
  fmTag(l);
  if (!KEBAB.test(l)) throw new Error(`link ${JSON.stringify(l)} must be kebab-case`);
  return l;
}

/** Serialize an entry back to its file form. Deterministic — round-trips parseEntry.
 *  Throws on frontmatter-breaking field content instead of writing a corrupt form. */
export function serializeEntry(e: KnowledgeEntry): string {
  const lines = [
    DELIM,
    `id: ${fmValue("id", e.id)}`,
    `type: ${fmValue("type", e.type)}`,
    `title: ${fmValue("title", e.title)}`,
    `tags: [${e.tags.map(fmTag).join(", ")}]`,
  ];
  if (e.source) lines.push(`source: ${fmValue("source", e.source)}`);
  lines.push(`created: ${fmValue("created", e.created)}`);
  // Lifecycle fields, in spec order, each omitted when absent/empty. Inserting them
  // between `created` and the closing delimiter keeps a field-less entry byte-identical.
  if (e.status) lines.push(`status: ${fmValue("status", e.status)}`);
  if (e.supersededBy) lines.push(`supersededBy: ${fmValue("supersededBy", e.supersededBy)}`);
  if (e.updated) lines.push(`updated: ${fmValue("updated", e.updated)}`);
  if (e.verifiedAt) lines.push(`verifiedAt: ${fmValue("verifiedAt", e.verifiedAt)}`);
  if (e.origin) lines.push(`origin: ${fmValue("origin", e.origin)}`);
  if (e.links && e.links.length) lines.push(`links: [${e.links.map(fmLink).join(", ")}]`);
  lines.push(DELIM, "", e.body.trimEnd(), "");
  return lines.join("\n");
}
