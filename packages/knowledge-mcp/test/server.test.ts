// Offline contract tests for the KB MCP server (plan 013 WP7): a real SDK Client
// talks to createKnowledgeServer over InMemoryTransport.createLinkedPair() — no
// network, no stdio spawn — with a FileKnowledgeStore over a temp dir (the same
// withStore pattern as packages/knowledge/test/file-store.test.ts). What's pinned:
// the resource surface (fresh index, per-entry reads, archived marking, unknown-id
// error), kb_search ranking + includeArchived, and kb_add inheriting the store's
// guards (collision + frontmatter round-trip) as MCP tool errors — never crashes.

import { test, expect } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  FileKnowledgeStore,
  renderIndex,
  serializeEntry,
} from "@objectcore/knowledge";
import type { KnowledgeEntryInput } from "@objectcore/knowledge";
import { createKnowledgeServer } from "../src/server";

// --- Fixtures: 3 active + 1 superseded, distinct vocabularies so search is decisive ---

const FIXTURES: KnowledgeEntryInput[] = [
  {
    id: "alpha-widget-lesson",
    type: "lesson",
    title: "Alpha widget lesson",
    tags: ["widget", "frobnication"],
    source: "test/fixtures",
    created: "2026-06-01",
    body: "Frobnicating the widget requires calibrated torque.\n",
  },
  {
    id: "beta-gadget-pattern",
    type: "pattern",
    title: "Gadget assembly pattern",
    tags: ["gadget"],
    created: "2026-06-02",
    body: "Assemble gadgets inside-out, never outside-in.\n",
  },
  {
    id: "delta-quux-decision",
    type: "decision",
    title: "Choose quux over blarg",
    tags: ["quux"],
    created: "2026-06-03",
    body: "Quux won on determinism grounds.\n",
  },
  {
    // Archived: must drop out of the index + default search, but stay listable/readable.
    id: "gamma-zorp-gotcha",
    type: "gotcha",
    title: "Zorp calibration gotcha",
    tags: ["zorp"],
    created: "2026-05-01",
    status: "superseded",
    supersededBy: "beta-gadget-pattern",
    body: "Zorp calibration drifts under load.\n",
  },
];

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

interface Harness {
  client: Client;
  store: FileKnowledgeStore;
  dir: string;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  readText(uri: string): Promise<string>;
}

/** Temp-dir store seeded with FIXTURES (unless `empty`), server + client linked over
 *  an in-memory pair. Everything is torn down (and the temp dir removed) after `fn`. */
async function withServer(
  fn: (h: Harness) => Promise<void>,
  opts: { empty?: boolean } = {},
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "kb-mcp-"));
  const store = new FileKnowledgeStore(join(dir, "knowledge"));
  const server = createKnowledgeServer(store);
  const client = new Client({ name: "kb-mcp-test", version: "0.0.0" });
  try {
    if (!opts.empty) for (const f of FIXTURES) await store.append(f);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    await fn({
      client,
      store,
      dir: join(dir, "knowledge"),
      callTool: async (name, args) =>
        (await client.callTool({ name, arguments: args })) as unknown as ToolResult,
      readText: async (uri) => {
        const res = await client.readResource({ uri });
        return (res.contents[0] as { text: string }).text;
      },
    });
  } finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
}

// --- Resources ---------------------------------------------------------------------

test("resources/list shows the index plus every entry (archived ones marked)", async () => {
  await withServer(async ({ client }) => {
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri).sort();
    expect(uris).toEqual(
      [
        "kb://index",
        ...FIXTURES.map((f) => `kb://entries/${f.id as string}`),
      ].sort(),
    );
    // Archived entries are listed but marked; active ones are not.
    const gamma = resources.find((r) => r.uri === "kb://entries/gamma-zorp-gotcha");
    expect(gamma?.description).toBe("[superseded] Zorp calibration gotcha");
    const alpha = resources.find((r) => r.uri === "kb://entries/alpha-widget-lesson");
    expect(alpha?.description).toBe("Alpha widget lesson");
  });
});

test("kb://index is a FRESH renderIndex over the store (active-only, never stale)", async () => {
  await withServer(async ({ store, readText }) => {
    const text = await readText("kb://index");
    expect(text).toBe(renderIndex(await store.list()));
    // Active entries are in; the superseded one is archived out (but counted).
    expect(text).toContain("](entries/alpha-widget-lesson.md)");
    expect(text).toContain("3 entries (1 archived).");
    expect(text).not.toContain("](entries/gamma-zorp-gotcha.md)");
  });
});

test("kb://index reflects a write immediately (fresh render, not the on-disk file)", async () => {
  await withServer(async ({ store, readText }) => {
    await store.append({
      id: "epsilon-new",
      type: "lesson",
      title: "Epsilon fresh lesson",
      created: "2026-07-01",
      body: "Fresh.\n",
    });
    expect(await readText("kb://index")).toContain("](entries/epsilon-new.md)");
  });
});

test("kb://entries/<id> returns the entry's exact file form (serializeEntry)", async () => {
  await withServer(async ({ store, readText }) => {
    const entry = await store.get("alpha-widget-lesson");
    expect(entry).not.toBeNull();
    expect(await readText("kb://entries/alpha-widget-lesson")).toBe(
      serializeEntry(entry as NonNullable<typeof entry>),
    );
    // Archived entries stay readable too (files are history; only the index forgets).
    const gamma = await store.get("gamma-zorp-gotcha");
    expect(await readText("kb://entries/gamma-zorp-gotcha")).toBe(
      serializeEntry(gamma as NonNullable<typeof gamma>),
    );
  });
});

test("reading an unknown entry id is a clear MCP error", async () => {
  await withServer(async ({ client }) => {
    expect(client.readResource({ uri: "kb://entries/no-such-entry" })).rejects.toThrow(
      /unknown knowledge entry "no-such-entry"/,
    );
  });
});

// --- kb_search ----------------------------------------------------------------------

test("kb_search returns the expected top hit as ranked JSON", async () => {
  await withServer(async ({ callTool }) => {
    const res = await callTool("kb_search", { query: "widget frobnication torque" });
    expect(res.isError).toBeUndefined();
    const hits = JSON.parse(res.content[0]!.text) as Array<{
      id: string;
      score: number;
      title: string;
      type: string;
      status: string;
    }>;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.id).toBe("alpha-widget-lesson");
    expect(hits[0]!.title).toBe("Alpha widget lesson");
    expect(hits[0]!.type).toBe("lesson");
    expect(hits[0]!.status).toBe("active");
    expect(hits[0]!.score).toBeGreaterThan(0);
  });
});

test("kb_search is active-only by default and respects includeArchived", async () => {
  await withServer(async ({ callTool }) => {
    const dflt = await callTool("kb_search", { query: "zorp calibration" });
    const defaultHits = JSON.parse(dflt.content[0]!.text) as Array<{ id: string }>;
    expect(defaultHits.map((h) => h.id)).not.toContain("gamma-zorp-gotcha");

    const all = await callTool("kb_search", {
      query: "zorp calibration",
      includeArchived: true,
    });
    const allHits = JSON.parse(all.content[0]!.text) as Array<{ id: string; status: string }>;
    expect(allHits[0]!.id).toBe("gamma-zorp-gotcha");
    expect(allHits[0]!.status).toBe("superseded");
  });
});

test("kb_search honors k and type filters", async () => {
  await withServer(async ({ callTool }) => {
    const res = await callTool("kb_search", { query: "quux gadget widget", k: 1 });
    const hits = JSON.parse(res.content[0]!.text) as Array<{ id: string }>;
    expect(hits.length).toBe(1);

    const typed = await callTool("kb_search", {
      query: "quux gadget widget",
      type: "decision",
    });
    const typedHits = JSON.parse(typed.content[0]!.text) as Array<{ type: string }>;
    expect(typedHits.every((h) => h.type === "decision")).toBe(true);
  });
});

// --- kb_add -------------------------------------------------------------------------

test("kb_add appends through the store: file lands on disk and the index regenerates", async () => {
  await withServer(async ({ callTool, store, dir }) => {
    const res = await callTool("kb_add", {
      type: "lesson",
      title: "A fresh MCP lesson",
      body: "Written over the access seam.",
      tags: ["mcp"],
      origin: "reflection",
    });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0]!.text)).toEqual({ id: "a-fresh-mcp-lesson" });

    // On disk, parseable, with the lifecycle field intact.
    const entry = await store.get("a-fresh-mcp-lesson");
    expect(entry?.origin).toBe("reflection");
    expect(existsSync(join(dir, "entries", "a-fresh-mcp-lesson.md"))).toBe(true);

    // INDEX.md was regenerated by the append and byte-matches a fresh render.
    expect(await readFile(join(dir, "INDEX.md"), "utf8")).toBe(
      renderIndex(await store.list()),
    );
  });
});

test("kb_add id collision surfaces as a tool error with the store's message", async () => {
  await withServer(async ({ callTool, store }) => {
    // "Alpha widget lesson" slugifies to the existing id alpha-widget-lesson.
    const res = await callTool("kb_add", {
      type: "lesson",
      title: "Alpha widget lesson",
      body: "Would collide.",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toBe('entry "alpha-widget-lesson" already exists');
    expect((await store.list()).length).toBe(FIXTURES.length); // nothing written
  });
});

test("kb_add rejects a frontmatter-breaking title as a tool error, nothing written", async () => {
  await withServer(async ({ callTool, store }) => {
    const res = await callTool("kb_add", {
      type: "gotcha",
      title: "line one\nstatus: injected",
      body: "Injection attempt.",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/single-line/);
    expect((await store.list()).length).toBe(FIXTURES.length); // nothing written
  });
});

// --- Self-gating on a missing KB dir (the main.ts posture) --------------------------

test("a missing KB dir self-gates: empty index, no entries, empty search, kb_add still works", async () => {
  await withServer(
    async ({ client, callTool, readText, store }) => {
      // Empty index (renderIndex over []), not an error.
      expect(await readText("kb://index")).toBe(renderIndex([]));

      // Only the static index resource is listed.
      const { resources } = await client.listResources();
      expect(resources.map((r) => r.uri)).toEqual(["kb://index"]);

      // Search over nothing returns [].
      const res = await callTool("kb_search", { query: "anything at all" });
      expect(JSON.parse(res.content[0]!.text)).toEqual([]);

      // kb_add creates the dir on first write (FileKnowledgeStore mkdir-s on append).
      const add = await callTool("kb_add", {
        type: "lesson",
        title: "First entry in a fresh project",
        body: "The store creates knowledge/entries on demand.",
      });
      expect(add.isError).toBeUndefined();
      expect((await store.list()).map((e) => e.id)).toEqual(["first-entry-in-a-fresh-project"]);
    },
    { empty: true },
  );
});
