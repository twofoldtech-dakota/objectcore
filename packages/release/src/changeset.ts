// Changeset parsing. We adopt the Changesets *file format* (a markdown file with a
// frontmatter map of name -> bump, then a summary) but NOT the @changesets CLI: its
// unit is an npm package, ours is a plugin (a dir with plugin.json, not a workspace).
// So the engine reads the familiar files and versions plugins itself. Pure parser;
// the script does the I/O of reading `.changeset/*.md`.

import type { Bump } from "./semver";

export interface Changeset {
  /** The file stem, e.g. "brave-lions-cheer". */
  id: string;
  /** plugin name -> requested bump. */
  bumps: Record<string, Bump>;
  /** The changelog body after the frontmatter fence. */
  summary: string;
}

const LINE = /^["']?([a-z0-9][a-z0-9-]*)["']?\s*:\s*["']?(major|minor|patch)["']?$/;

/** Parse one changeset file's contents. Throws on a malformed file. */
export function parseChangeset(id: string, content: string): Changeset {
  const text = content.replace(/\r\n/g, "\n").trim();
  if (!text.startsWith("---")) {
    throw new Error(`changeset "${id}" is missing its frontmatter (--- fence)`);
  }
  const close = text.indexOf("\n---", 3);
  if (close < 0) throw new Error(`changeset "${id}" frontmatter is not closed`);

  const front = text.slice(3, close).trim();
  const summary = text.slice(close + 4).trim();

  const bumps: Record<string, Bump> = {};
  for (const raw of front.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = LINE.exec(line);
    if (!m) throw new Error(`changeset "${id}" has an unparseable frontmatter line: ${raw}`);
    bumps[m[1] as string] = m[2] as Bump;
  }
  if (Object.keys(bumps).length === 0) {
    throw new Error(`changeset "${id}" names no plugins`);
  }
  return { id, bumps, summary };
}
