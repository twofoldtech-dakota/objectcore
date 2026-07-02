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

// --- append passes lifecycle fields through (kb:add can set `origin`) ---

test("append passes lifecycle input fields through and normalizes empties", async () => {
  await withStore(async (store) => {
    const e = await store.append({
      ...input,
      id: "with-origin",
      origin: "reflection",
      verifiedAt: "2026-07-02",
      links: [],
      supersededBy: "",
    });
    expect(e.origin).toBe("reflection");
    expect(e.verifiedAt).toBe("2026-07-02");
    expect(e.links).toBeUndefined(); // [] normalized to absent
    expect(e.supersededBy).toBeUndefined(); // "" normalized to absent
  });
});

// --- update ---

const todayStr = new Date().toISOString().slice(0, 10);

test("update stamps `updated` on a content change", async () => {
  await withStore(async (store) => {
    await store.append({ ...input, id: "u1" });
    const out = await store.update("u1", { title: "A new title" });
    expect(out.title).toBe("A new title");
    expect(out.updated).toBe(todayStr);
    // Persisted: re-reading shows the stamp.
    expect((await store.get("u1"))?.updated).toBe(todayStr);
  });
});

test("update with a verifiedAt-only patch does NOT bump `updated`", async () => {
  await withStore(async (store) => {
    await store.append({ ...input, id: "u2" });
    const out = await store.update("u2", { verifiedAt: todayStr });
    expect(out.verifiedAt).toBe(todayStr);
    expect(out.updated).toBeUndefined();
  });
});

test("update honors an explicit `updated` override", async () => {
  await withStore(async (store) => {
    await store.append({ ...input, id: "u3" });
    const out = await store.update("u3", { body: "Changed body.\n", updated: "2020-01-01" });
    expect(out.updated).toBe("2020-01-01");
  });
});

test("update rejects patching id or created", async () => {
  await withStore(async (store) => {
    await store.append({ ...input, id: "u4" });
    await expect(store.update("u4", { id: "other" } as never)).rejects.toThrow(/id is not patchable/);
    await expect(store.update("u4", { created: "2000-01-01" } as never)).rejects.toThrow(
      /created is not patchable/,
    );
  });
});

test("update clears source with an empty string", async () => {
  await withStore(async (store, dir) => {
    await store.append({ ...input, id: "u5", source: "orig" });
    const out = await store.update("u5", { source: "" });
    expect(out.source).toBeUndefined();
    expect(await readFile(join(dir, "entries", "u5.md"), "utf8")).not.toContain("source:");
  });
});

test("update never clobbers a corrupt on-disk entry", async () => {
  await withStore(async (store, dir) => {
    await mkdir(join(dir, "entries"), { recursive: true });
    const file = join(dir, "entries", "x.md");
    const garbage = "not frontmatter at all";
    await writeFile(file, garbage, "utf8");
    await expect(store.update("x", { title: "t" })).rejects.toThrow(/corrupt knowledge entry/);
    expect(await readFile(file, "utf8")).toBe(garbage);
  });
});

test("update rejects a missing entry", async () => {
  await withStore(async (store) => {
    await expect(store.update("ghost", { title: "t" })).rejects.toThrow(/does not exist/);
  });
});

// --- supersede ---

test("supersede archives the old entry, writes the replacement, and regenerates INDEX", async () => {
  await withStore(async (store, dir) => {
    await store.append({ ...input, id: "old", title: "Old" });
    const { superseded, replacement } = await store.supersede("old", {
      ...input,
      id: "new",
      title: "New",
    });
    expect(superseded.status).toBe("superseded");
    expect(superseded.supersededBy).toBe("new");
    expect(superseded.updated).toBe(todayStr);
    expect(replacement.id).toBe("new");
    expect(isActiveOnDisk(replacement)).toBe(true);

    // Both files exist on disk.
    expect(await readFile(join(dir, "entries", "old.md"), "utf8")).toContain("status: superseded");
    expect(await readFile(join(dir, "entries", "new.md"), "utf8")).toContain("title: New");

    // INDEX regenerated + in sync; the archived old drops out, the active new stays.
    const index = await readFile(join(dir, "INDEX.md"), "utf8");
    expect(index).toBe(renderIndex(await store.list()));
    expect(index).toContain("(1 archived)");
    expect(index).toContain("New");
    expect(index).not.toContain("](entries/old.md)");
  });
});

test("supersede rejects a replacement whose id already exists", async () => {
  await withStore(async (store) => {
    await store.append({ ...input, id: "old2", title: "Old2" });
    await store.append({ ...input, id: "taken", title: "Taken" });
    await expect(
      store.supersede("old2", { ...input, id: "taken", title: "Collides" }),
    ).rejects.toThrow(/already exists/);
  });
});

test("supersede rejects a missing old entry", async () => {
  await withStore(async (store) => {
    await expect(store.supersede("ghost", { ...input, id: "r", title: "R" })).rejects.toThrow(
      /does not exist/,
    );
  });
});

test("supersede leaves NO partial state when the replacement can't serialize", async () => {
  await withStore(async (store, dir) => {
    await store.append({ ...input, id: "keeper", title: "Keeper" });
    const before = await readFile(join(dir, "entries", "keeper.md"), "utf8");
    await expect(
      store.supersede("keeper", { ...input, id: "broken", title: "line one\nname: injected" }),
    ).rejects.toThrow(/single-line/);
    // Old entry untouched; the replacement was never written; still one active entry.
    expect(await readFile(join(dir, "entries", "keeper.md"), "utf8")).toBe(before);
    await expect(readFile(join(dir, "entries", "broken.md"), "utf8")).rejects.toThrow();
    const list = await store.list();
    expect(list.map((e) => e.id)).toEqual(["keeper"]);
    expect(list[0]!.status).toBeUndefined();
  });
});

function isActiveOnDisk(e: { status?: string }): boolean {
  return e.status === undefined || e.status === "active";
}
