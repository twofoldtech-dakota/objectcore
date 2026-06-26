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

/** Serialize an entry back to its file form. Deterministic — round-trips parseEntry. */
export function serializeEntry(e: KnowledgeEntry): string {
  const lines = [
    DELIM,
    `id: ${e.id}`,
    `type: ${e.type}`,
    `title: ${e.title}`,
    `tags: [${e.tags.join(", ")}]`,
  ];
  if (e.source) lines.push(`source: ${e.source}`);
  lines.push(`created: ${e.created}`, DELIM, "", e.body.trimEnd(), "");
  return lines.join("\n");
}
