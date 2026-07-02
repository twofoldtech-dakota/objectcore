// FileKnowledgeStore — the operated KnowledgeStore adapter: entries/<id>.md (one
// frontmatter'd file per entry, mirroring the project's memory/ store) plus a
// generated INDEX.md. Git-tracked and diffable so every lesson the loop writes is
// reviewable. A DbKnowledgeStore (Turso) and an MCP resource server are later
// adapters over the same port; nothing above KnowledgeStore changes when they land.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  KnowledgeEntry,
  KnowledgeEntryInput,
  KnowledgeEntryPatch,
  KnowledgeStore,
} from "./types";
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
    applyLifecycle(entry, input); // status/supersededBy/updated/verifiedAt/origin/links

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

  /** Apply a partial edit to an existing entry. `id`/`created` are NOT patchable.
   *  A field left `undefined` is untouched; `source: ""` clears it. `updated` is
   *  store-stamped on any content/lifecycle change (a verifiedAt-only patch does
   *  NOT bump it) unless the patch sets `updated` explicitly. A corrupt on-disk
   *  entry surfaces as a labeled error (via get()) and is never clobbered. */
  async update(id: string, patch: KnowledgeEntryPatch): Promise<KnowledgeEntry> {
    if ("id" in patch) throw new Error(`entry "${id}": id is not patchable`);
    if ("created" in patch) throw new Error(`entry "${id}": created is not patchable`);

    const existing = await this.get(id); // ENOENT → null; corrupt → labeled throw
    if (!existing) throw new Error(`entry "${id}" does not exist`);

    const next: KnowledgeEntry = { ...existing };
    let changed = false; // did a stamp-triggering field actually change?

    if (patch.type !== undefined && patch.type !== next.type) {
      next.type = patch.type;
      changed = true;
    }
    if (patch.title !== undefined && patch.title !== next.title) {
      next.title = patch.title;
      changed = true;
    }
    if (patch.tags !== undefined && !sameList(patch.tags, next.tags)) {
      next.tags = patch.tags;
      changed = true;
    }
    if (patch.source !== undefined) {
      const src = patch.source || undefined; // "" clears
      if (src !== next.source) {
        next.source = src;
        changed = true;
      }
    }
    if (patch.body !== undefined) {
      const body = patch.body.trimEnd() + "\n";
      if (body !== next.body) {
        next.body = body;
        changed = true;
      }
    }
    if (patch.status !== undefined && patch.status !== next.status) {
      next.status = patch.status;
      changed = true;
    }
    if (patch.supersededBy !== undefined) {
      const sb = patch.supersededBy || undefined;
      if (sb !== next.supersededBy) {
        next.supersededBy = sb;
        changed = true;
      }
    }
    if (patch.links !== undefined) {
      const links = patch.links.length ? patch.links : undefined;
      if (!sameList(links, next.links)) {
        next.links = links;
        changed = true;
      }
    }
    // origin + verifiedAt are applied but do NOT trigger the `updated` stamp
    // (verifiedAt is a "still true" confirmation, not a content change).
    if (patch.origin !== undefined) next.origin = patch.origin || undefined;
    if (patch.verifiedAt !== undefined) next.verifiedAt = patch.verifiedAt || undefined;

    if (patch.updated !== undefined) next.updated = patch.updated || undefined;
    else if (changed) next.updated = today();

    const text = serializeEntry(next);
    const round = roundTrips(next, text);
    if (round !== true) {
      throw new Error(
        `entry "${id}": ${round} would not survive the frontmatter round-trip — nothing was written`,
      );
    }

    await writeFile(join(this.entriesDir(), `${id}.md`), text, "utf8");
    await this.writeIndex();
    return next;
  }

  /** Retire `oldId` and write a fresh replacement, atomically. The replacement is
   *  assembled + validated exactly like append (kebab id, collision check); the old
   *  entry becomes `status: superseded` pointing at the replacement (with `updated`
   *  stamped). BOTH are serialized + round-tripped BEFORE either is written, so a
   *  failure on either side leaves no partial state. One INDEX regen at the end. */
  async supersede(
    oldId: string,
    replacement: KnowledgeEntryInput,
  ): Promise<{ superseded: KnowledgeEntry; replacement: KnowledgeEntry }> {
    const old = await this.get(oldId); // corrupt → labeled throw
    if (!old) throw new Error(`entry "${oldId}" does not exist`);

    const replId = replacement.id ?? slugify(replacement.title);
    if (!KEBAB.test(replId)) throw new Error(`entry id "${replId}" must be kebab-case`);
    if (await this.get(replId)) throw new Error(`entry "${replId}" already exists`);

    const replEntry: KnowledgeEntry = {
      id: replId,
      type: replacement.type,
      title: replacement.title,
      tags: replacement.tags ?? [],
      source: replacement.source || undefined,
      created: replacement.created ?? today(),
      body: replacement.body.trimEnd() + "\n",
    };
    applyLifecycle(replEntry, replacement);

    const supersededOld: KnowledgeEntry = {
      ...old,
      status: "superseded",
      supersededBy: replId,
      updated: today(),
    };

    // Serialize + round-trip BOTH before writing EITHER — no partial state on failure.
    const replText = serializeEntry(replEntry);
    const replRound = roundTrips(replEntry, replText);
    if (replRound !== true) {
      throw new Error(
        `entry "${replId}": ${replRound} would not survive the frontmatter round-trip — nothing was written`,
      );
    }
    const oldText = serializeEntry(supersededOld);
    const oldRound = roundTrips(supersededOld, oldText);
    if (oldRound !== true) {
      throw new Error(
        `entry "${oldId}": ${oldRound} would not survive the frontmatter round-trip — nothing was written`,
      );
    }

    await mkdir(this.entriesDir(), { recursive: true });
    await writeFile(join(this.entriesDir(), `${replId}.md`), replText, "utf8");
    await writeFile(join(this.entriesDir(), `${oldId}.md`), oldText, "utf8");
    await this.writeIndex();
    return { superseded: supersededOld, replacement: replEntry };
  }

  /** Regenerate INDEX.md from the entries on disk. Returns the written text. */
  async writeIndex(): Promise<string> {
    const text = renderIndex(await this.list());
    await writeFile(join(this.dir, "INDEX.md"), text, "utf8");
    return text;
  }
}

/** True when `text` parses back to exactly `entry`; otherwise the name of the
 *  first field that drifted (parseEntry trims values, so e.g. a padded title is lossy).
 *  EVERY field must be compared — a forgotten one is a silent lossy write. Exported
 *  (off the package's public index) so the guard's per-field naming is directly tested. */
export function roundTrips(entry: KnowledgeEntry, text: string): true | string {
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
  if (parsed.status !== entry.status) return "field `status`";
  if (parsed.supersededBy !== entry.supersededBy) return "field `supersededBy`";
  if (parsed.updated !== entry.updated) return "field `updated`";
  if (parsed.verifiedAt !== entry.verifiedAt) return "field `verifiedAt`";
  if (parsed.origin !== entry.origin) return "field `origin`";
  if (JSON.stringify(parsed.links) !== JSON.stringify(entry.links)) return "field `links`";
  if (parsed.body !== entry.body) return "field `body`";
  return true;
}

/** Copy the optional lifecycle fields off an input onto an assembled entry,
 *  normalizing empties to absent (empty string / empty array → undefined) so the
 *  round-trip guard and renderIndex treat "" and [] the way the file form does. */
function applyLifecycle(entry: KnowledgeEntry, src: KnowledgeEntryInput): void {
  if (src.status) entry.status = src.status;
  if (src.supersededBy) entry.supersededBy = src.supersededBy;
  if (src.updated) entry.updated = src.updated;
  if (src.verifiedAt) entry.verifiedAt = src.verifiedAt;
  if (src.origin) entry.origin = src.origin;
  if (src.links && src.links.length) entry.links = src.links;
}

/** Order-sensitive list equality, undefined-tolerant (undefined ≡ absent). */
function sameList(a: string[] | undefined, b: string[] | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
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
