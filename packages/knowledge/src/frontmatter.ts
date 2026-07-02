// Hand-rolled, zero-dep parse/serialize for a knowledge entry's file form
// (frontmatter + markdown body). Intentionally strict and specific to the entry
// shape — same reasoning as registry-core/schema.ts hand-rolling its checks: keep
// the package dependency-free and the format auditable.

import type { EntryType, KnowledgeEntry } from "./types";
import { ENTRY_TYPES } from "./types";

const DELIM = "---";

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
    fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }

  const type = fields.type as EntryType;
  if (!ENTRY_TYPES.includes(type)) throw new Error(`entry "${id}": invalid type "${fields.type}"`);
  if (!fields.title) throw new Error(`entry "${id}": missing title`);
  if (!fields.created) throw new Error(`entry "${id}": missing created`);

  return {
    id,
    type,
    title: fields.title,
    tags: parseTags(fields.tags ?? ""),
    source: fields.source || undefined,
    created: fields.created,
    body: body.trimEnd() + "\n",
  };
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
  lines.push(`created: ${fmValue("created", e.created)}`, DELIM, "", e.body.trimEnd(), "");
  return lines.join("\n");
}
