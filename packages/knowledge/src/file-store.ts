// FileKnowledgeStore — the operated KnowledgeStore adapter: entries/<id>.md (one
// frontmatter'd file per entry, mirroring the project's memory/ store) plus a
// generated INDEX.md. Git-tracked and diffable so every lesson the loop writes is
// reviewable. A DbKnowledgeStore (Turso) and an MCP resource server are later
// adapters over the same port; nothing above KnowledgeStore changes when they land.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { KnowledgeEntry, KnowledgeEntryInput, KnowledgeStore } from "./types";
import { parseEntry, serializeEntry } from "./frontmatter";
import { renderIndex } from "./render";

// Mirrored from registry-core's kebab rule (ids are slugs, like plugin names).
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class FileKnowledgeStore implements KnowledgeStore {
  constructor(private readonly dir: string) {}

  private entriesDir(): string {
    return join(this.dir, "entries");
  }

  /** Parse one on-disk entry, labeling any parse failure with the file path — a
   *  corrupt entry must surface as corruption, never masquerade as missing. */
  private parseFile(id: string, file: string, raw: string): KnowledgeEntry {
    try {
      return parseEntry(id, raw);
    } catch (e) {
      throw new Error(`corrupt knowledge entry ${file}: ${(e as Error).message}`);
    }
  }

  async list(): Promise<KnowledgeEntry[]> {
    let files: string[];
    try {
      files = await readdir(this.entriesDir());
    } catch {
      return [];
    }
    const entries: KnowledgeEntry[] = [];
    for (const f of files.sort()) {
      if (!f.endsWith(".md")) continue;
      const id = f.slice(0, -3);
      const file = join(this.entriesDir(), f);
      entries.push(this.parseFile(id, file, await readFile(file, "utf8")));
    }
    return entries;
  }

  async get(id: string): Promise<KnowledgeEntry | null> {
    const file = join(this.entriesDir(), `${id}.md`);
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (e) {
      // Only "missing" maps to null; anything else (including corruption, below)
      // must throw, so append()'s collision check can never clobber a corrupt entry.
      if ((e as { code?: string }).code === "ENOENT") return null;
      throw e;
    }
    return this.parseFile(id, file, raw);
  }

  async append(input: KnowledgeEntryInput): Promise<KnowledgeEntry> {
    const id = input.id ?? slugify(input.title);
    if (!KEBAB.test(id)) throw new Error(`entry id "${id}" must be kebab-case`);
    if (await this.get(id)) throw new Error(`entry "${id}" already exists`);

    const entry: KnowledgeEntry = {
      id,
      type: input.type,
      title: input.title,
      tags: input.tags ?? [],
      source: input.source || undefined, // "" is "no source" — the file form can't distinguish them
      created: input.created ?? today(),
      body: input.body.trimEnd() + "\n",
    };

    // Round-trip guard: serialize (which rejects frontmatter-breaking fields), then
    // prove parseEntry recovers the exact entry BEFORE anything touches disk. One bad
    // append must never brick the store (list()/kb:index/kb:check all reparse it).
    const text = serializeEntry(entry);
    const round = roundTrips(entry, text);
    if (round !== true) {
      throw new Error(
        `entry "${id}": ${round} would not survive the frontmatter round-trip — nothing was written`,
      );
    }

    await mkdir(this.entriesDir(), { recursive: true });
    await writeFile(join(this.entriesDir(), `${id}.md`), text, "utf8");
    await this.writeIndex();
    return entry;
  }

  /** Regenerate INDEX.md from the entries on disk. Returns the written text. */
  async writeIndex(): Promise<string> {
    const text = renderIndex(await this.list());
    await writeFile(join(this.dir, "INDEX.md"), text, "utf8");
    return text;
  }
}

/** True when `text` parses back to exactly `entry`; otherwise the name of the
 *  first field that drifted (parseEntry trims values, so e.g. a padded title is lossy). */
function roundTrips(entry: KnowledgeEntry, text: string): true | string {
  let parsed: KnowledgeEntry;
  try {
    parsed = parseEntry(entry.id, text);
  } catch (e) {
    return (e as Error).message;
  }
  if (parsed.type !== entry.type) return "field `type`";
  if (parsed.title !== entry.title) return "field `title`";
  if (parsed.source !== entry.source) return "field `source`";
  if (parsed.created !== entry.created) return "field `created`";
  if (JSON.stringify(parsed.tags) !== JSON.stringify(entry.tags)) return "field `tags`";
  if (parsed.body !== entry.body) return "field `body`";
  return true;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
