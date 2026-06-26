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
      entries.push(parseEntry(id, await readFile(join(this.entriesDir(), f), "utf8")));
    }
    return entries;
  }

  async get(id: string): Promise<KnowledgeEntry | null> {
    try {
      return parseEntry(id, await readFile(join(this.entriesDir(), `${id}.md`), "utf8"));
    } catch {
      return null;
    }
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
      source: input.source,
      created: input.created ?? today(),
      body: input.body.trimEnd() + "\n",
    };

    await mkdir(this.entriesDir(), { recursive: true });
    await writeFile(join(this.entriesDir(), `${id}.md`), serializeEntry(entry), "utf8");
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

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
