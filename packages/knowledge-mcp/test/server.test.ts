// Offline contract tests for the KB MCP server (plan 013 WP7): a real SDK Client
// talks to createKnowledgeServer over InMemoryTransport.createLinkedPair() — no
// network, no stdio spawn — with a FileKnowledgeStore over a temp dir (the same
// withStore pattern as packages/knowledge/test/file-store.test.ts). What's pinned:
// the resource surface (fresh index, per-entry reads, archived marking, unknown-id
// error), kb_search ranking + includeArchived, kb_add inheriting the store's guards
// (collision + frontmatter round-trip) as MCP tool errors — never crashes — plus the
// WP7 follow-up: kb_add's WP4 near-duplicate refusal (+ force override) and the
// SINK-GATED kb_cite tool (present only with a usage log; appends a parseUsageLog-
// round-tripping line; unknown-id error; archived-target warning).

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
  parseUsageLog,
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
  /** The kb_cite usage-log path — set only when `withServer(..., { usageLog: true })`. */
  usageLog?: string;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  readText(uri: string): Promise<string>;
}

/** Temp-dir store seeded with FIXTURES (unless `empty`), server + client linked over
 *  an in-memory pair. With `usageLog`, a usage-log path (OUTSIDE the KB dir, proving the
 *  kb_cite sink is independent of the KB root) is injected — otherwise kb_cite is
 *  unregistered (the sink-gated posture). Everything is torn down (temp dir removed). */
async function withServer(
  fn: (h: Harness) => Promise<void>,
  opts: { empty?: boolean; usageLog?: boolean } = {},
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "kb-mcp-"));
  const store = new FileKnowledgeStore(join(dir, "knowledge"));
  const usageLog = opts.usageLog ? join(dir, "kb-usage.jsonl") : undefined;
  const server = createKnowledgeServer(store, usageLog ? { usageLogPath: usageLog } : {});
  const client = new Client({ name: "kb-mcp-test", version: "0.0.0" });
  try {
    if (!opts.empty) for (const f of FIXTURES) await store.append(f);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    await fn({
      client,
      store,
      dir: join(dir, "knowledge"),
      usageLog,
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
    // "Alpha widget lesson" slugifies to the existing id alpha-widget-lesson. force: true
    // bypasses the WP4 near-duplicate refusal so this targets the STORE's collision guard.
    const res = await callTool("kb_add", {
      type: "lesson",
      title: "Alpha widget lesson",
      body: "Would collide.",
      force: true,
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toBe('entry "alpha-widget-lesson" already exists');
    expect((await store.list()).length).toBe(FIXTURES.length); // nothing written
  });
});

test("kb_add rejects a frontmatter-breaking title as a tool error, nothing written", async () => {
  await withServer(async ({ callTool, store }) => {
    // force past dedup so this targets the store's frontmatter round-trip guard.
    const res = await callTool("kb_add", {
      type: "gotcha",
      title: "line one\nstatus: injected",
      body: "Injection attempt.",
      force: true,
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/single-line/);
    expect((await store.list()).length).toBe(FIXTURES.length); // nothing written
  });
});

// --- kb_add WP4 dedup refusal (+ force override) ------------------------------------

test("kb_add refuses a near-duplicate of an active entry, naming the match, nothing written", async () => {
  await withServer(async ({ callTool, store }) => {
    // A re-worded copy of the seeded alpha-widget-lesson (shared title/tag/body tokens);
    // scores ~0.71 cosine, over DUP_THRESHOLD (0.57).
    const res = await callTool("kb_add", {
      type: "lesson",
      title: "Widget frobnication needs torque",
      tags: ["widget", "frobnication"],
      body: "Frobnicating the widget requires calibrated torque.",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("alpha-widget-lesson");
    expect(res.content[0]!.text).toContain("force: true"); // the documented override
    expect((await store.list()).length).toBe(FIXTURES.length); // refused before any write
  });
});

test("kb_add force: true overrides the near-duplicate refusal and writes", async () => {
  await withServer(async ({ callTool, store }) => {
    const res = await callTool("kb_add", {
      type: "lesson",
      title: "Widget frobnication needs torque",
      tags: ["widget", "frobnication"],
      body: "Frobnicating the widget requires calibrated torque.",
      force: true,
    });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0]!.text)).toEqual({ id: "widget-frobnication-needs-torque" });
    expect(await store.get("widget-frobnication-needs-torque")).not.toBeNull();
  });
});

test("kb_add writes a non-duplicate without force (dedup runs but finds no match)", async () => {
  await withServer(async ({ callTool, store }) => {
    const res = await callTool("kb_add", {
      type: "decision",
      title: "Gizmo calibration decision",
      body: "Gizmos need periodic recalibration to stay accurate.",
    });
    expect(res.isError).toBeUndefined();
    const out = JSON.parse(res.content[0]!.text) as { id: string };
    expect(typeof out.id).toBe("string");
    expect((await store.list()).length).toBe(FIXTURES.length + 1);
  });
});

// --- kb_cite (WP5) — SINK-GATED -----------------------------------------------------

test("kb_cite is ABSENT from tools/list when no usage log is configured", async () => {
  await withServer(async ({ client }) => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("kb_search");
    expect(names).toContain("kb_add");
    expect(names).not.toContain("kb_cite"); // sink-gated: no sink, no tool
  });
});

test("kb_cite is registered when a usage log IS configured", async () => {
  await withServer(
    async ({ client }) => {
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toContain("kb_cite");
    },
    { usageLog: true },
  );
});

test("kb_cite appends a line that parseUsageLog round-trips", async () => {
  await withServer(
    async ({ callTool, usageLog }) => {
      const res = await callTool("kb_cite", {
        id: "alpha-widget-lesson",
        source: "reflection:demo",
      });
      expect(res.isError).toBeUndefined();
      expect(res.content[0]!.text).toContain("alpha-widget-lesson");

      const events = parseUsageLog(await readFile(usageLog as string, "utf8"));
      expect(events.length).toBe(1);
      expect(events[0]!.id).toBe("alpha-widget-lesson");
      expect(events[0]!.source).toBe("reflection:demo");
      expect(events[0]!.citedAt.length).toBeGreaterThan(0);
    },
    { usageLog: true },
  );
});

test("kb_cite appends (never rewrites) on a second citation", async () => {
  await withServer(
    async ({ callTool, usageLog }) => {
      await callTool("kb_cite", { id: "alpha-widget-lesson" });
      await callTool("kb_cite", { id: "beta-gadget-pattern", source: "s" });
      const events = parseUsageLog(await readFile(usageLog as string, "utf8"));
      expect(events.map((e) => e.id)).toEqual([
        "alpha-widget-lesson",
        "beta-gadget-pattern",
      ]);
    },
    { usageLog: true },
  );
});

test("kb_cite on an unknown id is a tool error, nothing appended", async () => {
  await withServer(
    async ({ callTool, usageLog }) => {
      const res = await callTool("kb_cite", { id: "no-such-entry" });
      expect(res.isError).toBe(true);
      expect(res.content[0]!.text).toContain("no-such-entry");
      expect(existsSync(usageLog as string)).toBe(false); // error path never touches the sink
    },
    { usageLog: true },
  );
});

test("kb_cite on an archived entry still appends, with a warning in the result", async () => {
  await withServer(
    async ({ callTool, usageLog }) => {
      // gamma-zorp-gotcha is superseded — history is history, so the citation still lands.
      const res = await callTool("kb_cite", { id: "gamma-zorp-gotcha" });
      expect(res.isError).toBeUndefined();
      expect(res.content[0]!.text.toLowerCase()).toContain("warning");
      const events = parseUsageLog(await readFile(usageLog as string, "utf8"));
      expect(events.map((e) => e.id)).toEqual(["gamma-zorp-gotcha"]);
    },
    { usageLog: true },
  );
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
