// FileKnowledgeStore — the loop's only durable write path, so the disk behavior is
// pinned here: append/get/list round-trip, collision rejection, and (the load-bearing
// edge) a CORRUPT entry surfaces as a labeled error instead of masquerading as
// missing — which is what used to let append() silently clobber it.

import { test, expect } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileKnowledgeStore, renderIndex } from "../src/index";
import type { KnowledgeEntryInput } from "../src/index";

const input: KnowledgeEntryInput = {
  type: "lesson",
  title: "A temp-dir lesson",
  tags: ["a", "b"],
  source: "test",
  created: "2026-07-01",
  body: "Body line.\n",
};

async function withStore(fn: (store: FileKnowledgeStore, dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "kb-store-"));
  try {
    await fn(new FileKnowledgeStore(dir), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("append -> get -> list round-trips and regenerates INDEX.md", async () => {
  await withStore(async (store, dir) => {
    const entry = await store.append(input);
    expect(entry.id).toBe("a-temp-dir-lesson"); // slugified from the title
    expect(await store.get(entry.id)).toEqual(entry);
    const listed = await store.list();
    expect(listed).toEqual([entry]);
    // INDEX.md is written on append and byte-matches a fresh render.
    expect(await readFile(join(dir, "INDEX.md"), "utf8")).toBe(renderIndex(listed));
  });
});

test("get() returns null for a missing entry (ENOENT only)", async () => {
  await withStore(async (store) => {
    expect(await store.get("no-such-entry")).toBeNull();
  });
});

test("a second append with the same id is rejected", async () => {
  await withStore(async (store) => {
    await store.append({ ...input, id: "dup" });
    expect(store.append({ ...input, id: "dup" })).rejects.toThrow(/already exists/);
  });
});

test("an explicit non-kebab id is rejected", async () => {
  await withStore(async (store) => {
    expect(store.append({ ...input, id: "Not_Kebab" })).rejects.toThrow(/kebab-case/);
  });
});

test("an all-punctuation title slugifies to '' and trips the kebab guard", async () => {
  await withStore(async (store) => {
    expect(store.append({ ...input, title: "!!! ???" })).rejects.toThrow(/kebab-case/);
  });
});

test("list() skips non-.md files in entries/", async () => {
  await withStore(async (store, dir) => {
    await store.append({ ...input, id: "real" });
    await writeFile(join(dir, "entries", "notes.txt"), "not an entry", "utf8");
    expect((await store.list()).map((e) => e.id)).toEqual(["real"]);
  });
});

test("a corrupt entry surfaces as a labeled error, never as 'missing'", async () => {
  await withStore(async (store, dir) => {
    await mkdir(join(dir, "entries"), { recursive: true });
    const file = join(dir, "entries", "x.md");
    await writeFile(file, "not frontmatter at all", "utf8");
    // get(): corrupt ≠ missing — the error names the file.
    expect(store.get("x")).rejects.toThrow(/corrupt knowledge entry .*x\.md/);
    // list() reports it too (this is what kb:check surfaces by filename).
    expect(store.list()).rejects.toThrow(/corrupt knowledge entry .*x\.md/);
  });
});

test("append() with a corrupt entry's id rejects instead of overwriting it", async () => {
  await withStore(async (store, dir) => {
    await mkdir(join(dir, "entries"), { recursive: true });
    const file = join(dir, "entries", "x.md");
    const garbage = "not frontmatter at all";
    await writeFile(file, garbage, "utf8");
    expect(store.append({ ...input, id: "x" })).rejects.toThrow(/corrupt knowledge entry/);
    // The original (corrupt) content is untouched — nothing was clobbered.
    expect(await readFile(file, "utf8")).toBe(garbage);
  });
});

test("a frontmatter-breaking title is rejected BEFORE anything is written", async () => {
  await withStore(async (store, dir) => {
    await expect(
      store.append({ ...input, title: "line one\nname: injected" }),
    ).rejects.toThrow(/single-line/);
    // Nothing landed: no entries/, no INDEX.md.
    expect(await store.list()).toEqual([]);
    expect(readFile(join(dir, "INDEX.md"), "utf8")).rejects.toThrow();
  });
});

test("a tag containing ',' is rejected before writing", async () => {
  await withStore(async (store) => {
    await expect(store.append({ ...input, tags: ["a,b"] })).rejects.toThrow(/tag/);
    expect(await store.list()).toEqual([]);
  });
});

test("a padded title fails the round-trip guard (parseEntry trims values)", async () => {
  await withStore(async (store) => {
    await expect(store.append({ ...input, id: "padded", title: "  padded  " })).rejects.toThrow(
      /round-trip/,
    );
    expect(await store.list()).toEqual([]);
  });
});
