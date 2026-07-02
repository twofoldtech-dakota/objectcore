// The KB's ACCESS seam — an MCP resource server over the KnowledgeStore port, the
// knowledge base's analogue of the /v1/marketplace.json route over CatalogSource.
// Reads/writes go through the SAME store the CLIs use; nothing here re-derives.
//
// `@objectcore/knowledge-mcp` is the ONLY package allowed to depend on
// `@modelcontextprotocol/sdk` (exact-pinned, plus the zod the SDK's tool-schema API
// requires as a direct import) — mirroring @objectcore/registry-db being the only
// `@libsql/client` dependent. The core (@objectcore/knowledge) stays zero-dep; the SDK
// lives out here at the edge, so a transport/protocol dependency never leaks into the
// pure knowledge package (plan 013 WP7).
//
// Surface: two resources + up to three tools.
//   - kb://index            — a FRESH renderIndex over ACTIVE entries (never the
//                             on-disk INDEX.md, so it can't serve a stale snapshot).
//   - kb://entries/{id}     — one entry's file form (serializeEntry); archived
//                             entries are listed too, marked in their description.
//   - kb_search             — deterministic lexical retrieval (WP3 searchEntries).
//   - kb_add                — a write through store.append. WP4 near-duplicate refusal
//                             runs FIRST (matches named; `force: true` overrides); the
//                             store's collision + round-trip guards then apply — every
//                             failure surfaces as an MCP tool error, never a crash.
//   - kb_cite               — record a citation to the usage log (WP5). SINK-GATED:
//                             registered ONLY when `opts.usageLogPath` is provided (the
//                             registry `events`-route posture — absent = the tool does
//                             not exist).
// The WP4 dedup + WP5 kb_cite integrations (plan 013 WP7 follow-up) mirror the
// scripts/kb-add.ts / scripts/kb-cite.ts CLI edges exactly (same DUP_THRESHOLD default,
// active-only pool, and append mechanics).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  renderIndex,
  serializeEntry,
  isActive,
  searchEntries,
  findNearDuplicates,
  serializeUsageEvent,
} from "@objectcore/knowledge";
import type {
  KnowledgeStore,
  KnowledgeEntryInput,
  SearchOptions,
  UsageEvent,
} from "@objectcore/knowledge";

export interface KnowledgeMcpOptions {
  /** Server name advertised in the MCP handshake. Default: "objectcore-kb". */
  name?: string;
  /** Server version advertised in the MCP handshake. Default: "0.0.1". */
  version?: string;
  /** Path (absolute or cwd-relative) to the append-only usage log
   *  (metrics/kb-usage.jsonl). When provided, the `kb_cite` tool is registered
   *  (SINK-GATED — absent = no citation tool, the registry `events`-route posture). */
  usageLogPath?: string;
}

// The four entry types + two origins, as zod-enum tuples. Spelled out (not derived
// from ENTRY_TYPES) so `z.enum` infers the exact literal union for the tool arg types.
const ENTRY_TYPE_VALUES = ["lesson", "pattern", "gotcha", "decision"] as const;
const ENTRY_ORIGIN_VALUES = ["manual", "reflection"] as const;

/** Build the MCP server over a KnowledgeStore. Pure wiring — the store is injected,
 *  so the same server runs over FileKnowledgeStore (main.ts) or a temp-dir store
 *  (tests, via InMemoryTransport). Returns an unconnected McpServer; the caller
 *  attaches a transport (stdio in production, in-memory in tests). */
export function createKnowledgeServer(
  store: KnowledgeStore,
  opts: KnowledgeMcpOptions = {},
): McpServer {
  const server = new McpServer({
    name: opts.name ?? "objectcore-kb",
    version: opts.version ?? "0.0.1",
  });

  // --- Resource: kb://index ---------------------------------------------------------
  // A FRESH render over the live store — never a read of the committed INDEX.md, so an
  // agent reading this resource can never see a stale index. renderIndex filters to
  // active entries itself (bounded forgetting); a missing KB dir yields [] → an empty
  // index, never an error.
  server.registerResource(
    "kb-index",
    "kb://index",
    {
      title: "Knowledge base index",
      description:
        "The bounded index of ACTIVE knowledge entries, rendered fresh from the store " +
        "(the same output as `bun run kb:index`, never the on-disk INDEX.md).",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const entries = await store.list();
      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: renderIndex(entries) }],
      };
    },
  );

  // --- Resource template: kb://entries/{id} -----------------------------------------
  // Lists ALL entries (archived included — marked `[superseded]`/`[deprecated]` in the
  // description so a reader can tell them apart); a read returns the entry's file form.
  // An unknown id throws → the client sees a clear MCP error (not an empty/blank read).
  server.registerResource(
    "kb-entry",
    new ResourceTemplate("kb://entries/{id}", {
      list: async () => {
        const entries = await store.list();
        return {
          resources: entries.map((e) => ({
            uri: `kb://entries/${e.id}`,
            name: e.id,
            title: e.title,
            description: isActive(e) ? e.title : `[${e.status}] ${e.title}`,
            mimeType: "text/markdown",
          })),
        };
      },
    }),
    {
      title: "Knowledge base entry",
      description: "A single knowledge entry in its file form (frontmatter + body).",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const raw = variables.id;
      const id = Array.isArray(raw) ? raw[0] : raw;
      const entry = id ? await store.get(String(id)) : null;
      if (!entry) throw new Error(`unknown knowledge entry "${String(id)}"`);
      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: serializeEntry(entry) }],
      };
    },
  );

  // --- Tool: kb_search --------------------------------------------------------------
  // Wraps WP3's deterministic searchEntries over the live store. Returns a JSON array
  // of ranked hits — the score is rounded to 3dp (matching `bun run kb:search --json`).
  server.registerTool(
    "kb_search",
    {
      title: "Search the knowledge base",
      description:
        "Deterministic lexical retrieval over knowledge entries. Returns a JSON array " +
        "of ranked hits ({ id, score, title, type, status }); active-only unless " +
        "includeArchived is set.",
      inputSchema: {
        query: z.string().min(1),
        k: z.number().int().positive().optional(),
        type: z.enum(ENTRY_TYPE_VALUES).optional(),
        tag: z.string().optional(),
        includeArchived: z.boolean().optional(),
      },
    },
    async ({ query, k, type, tag, includeArchived }) => {
      const entries = await store.list();
      const searchOpts: SearchOptions = {};
      if (k !== undefined) searchOpts.k = k;
      if (type !== undefined) searchOpts.type = type;
      if (tag !== undefined) searchOpts.tag = tag;
      if (includeArchived !== undefined) searchOpts.includeArchived = includeArchived;
      const hits = searchEntries(entries, query, searchOpts);
      const out = hits.map((h) => ({
        id: h.id,
        score: Number(h.score.toFixed(3)),
        title: h.entry.title,
        type: h.entry.type,
        status: h.entry.status ?? "active",
      }));
      return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
    },
  );

  // --- Tool: kb_add -----------------------------------------------------------------
  // A write through store.append — inheriting the store's guards verbatim: kebab-id +
  // collision refusal and the frontmatter round-trip guard (a newline-bearing title,
  // etc. is rejected BEFORE anything touches disk). Every store failure surfaces as an
  // MCP tool error (isError: true) carrying the store's message, never a thrown crash.
  //
  // WP4 dedup (plan 013): findNearDuplicates over the ACTIVE corpus runs FIRST and
  // refuses a near-duplicate (matches named) unless `force: true` overrides — mirroring
  // scripts/kb-add.ts exactly (same DUP_THRESHOLD default, active-only pool). The refusal
  // is enforced HERE at the edge; the store stays a pure storage seam.
  server.registerTool(
    "kb_add",
    {
      title: "Add a knowledge entry",
      description:
        "Append a new knowledge entry (lesson | pattern | gotcha | decision) through " +
        "the store. Returns { id } on success. A near-duplicate of an existing active " +
        "entry is refused (pass force: true to override); store failures (id collision, " +
        "kebab violation, frontmatter-breaking values) are returned as tool errors.",
      inputSchema: {
        type: z.enum(ENTRY_TYPE_VALUES),
        title: z.string().min(1),
        body: z.string().min(1),
        tags: z.array(z.string()).optional(),
        source: z.string().optional(),
        links: z.array(z.string()).optional(),
        origin: z.enum(ENTRY_ORIGIN_VALUES).optional(),
        force: z.boolean().optional(),
      },
    },
    async ({ type, title, body, tags, source, links, origin, force }) => {
      // WP4 write-time dedup: refuse a near-duplicate of an ACTIVE entry unless forced.
      if (!force) {
        const active = (await store.list()).filter(isActive);
        const dups = findNearDuplicates({ title, tags, body }, active);
        if (dups.length) {
          const matches = dups
            .map((d) => `${d.id} (score ${d.score.toFixed(2)})`)
            .join("\n  ");
          return {
            content: [
              {
                type: "text",
                text:
                  `near-duplicate of an existing active entry:\n  ${matches}\n` +
                  "update or supersede it (bun run kb:curate), or retry with force: true",
              },
            ],
            isError: true,
          };
        }
      }
      const input: KnowledgeEntryInput = { type, title, body };
      if (tags) input.tags = tags;
      if (source !== undefined) input.source = source;
      if (links) input.links = links;
      if (origin) input.origin = origin;
      try {
        const entry = await store.append(input);
        return { content: [{ type: "text", text: JSON.stringify({ id: entry.id }) }] };
      } catch (e) {
        return { content: [{ type: "text", text: (e as Error).message }], isError: true };
      }
    },
  );

  // --- Tool: kb_cite (WP5) — SINK-GATED ---------------------------------------------
  // Registered ONLY when opts.usageLogPath is provided (the registry `events`-route
  // posture: absent unless the sink is injected). Records ONE citation to the append-only
  // usage log; the append mechanics mirror scripts/kb-cite.ts (read-first, missing-
  // trailing-newline guard, create-if-absent). The id must resolve via store.get (unknown
  // → tool error); citing a since-archived entry still appends (history is history) but
  // the result text carries a warning.
  if (opts.usageLogPath !== undefined) {
    const usageLogPath = opts.usageLogPath;
    server.registerTool(
      "kb_cite",
      {
        title: "Cite a knowledge entry",
        description:
          "Record a citation of a knowledge entry to the append-only usage log " +
          "(metrics/kb-usage.jsonl) — the KB's usage/ROI signal. The id must resolve " +
          "(unknown → tool error); citing an archived (superseded/deprecated) entry still " +
          "appends, with a warning in the result.",
        inputSchema: {
          id: z.string().min(1),
          source: z.string().optional(),
        },
      },
      async ({ id, source }) => {
        // The id must resolve — a corrupt entry throws (labeled), a missing entry is null.
        let entry;
        try {
          entry = await store.get(id);
        } catch (e) {
          return { content: [{ type: "text", text: (e as Error).message }], isError: true };
        }
        if (!entry) {
          return {
            content: [{ type: "text", text: `unknown knowledge entry "${id}"` }],
            isError: true,
          };
        }
        // Normalize an empty/whitespace source to "no source" (kb:cite's `|| undefined`).
        const src = source && source.trim() ? source : undefined;
        const event: UsageEvent = src
          ? { citedAt: new Date().toISOString(), id, source: src }
          : { citedAt: new Date().toISOString(), id };

        // Append one line — mirror scripts/kb-cite.ts: read the existing file, guard a
        // missing trailing newline, create the file (and its dir) if absent.
        mkdirSync(dirname(usageLogPath), { recursive: true });
        const prefix = existsSync(usageLogPath) ? readFileSync(usageLogPath, "utf8") : "";
        const sep = prefix.length && !prefix.endsWith("\n") ? "\n" : "";
        writeFileSync(usageLogPath, prefix + sep + serializeUsageEvent(event) + "\n", "utf8");

        const warning = isActive(entry) ? "" : ` (warning: entry is ${entry.status})`;
        return {
          content: [
            {
              type: "text",
              text: `cited "${id}"${src ? ` (source: ${src})` : ""}${warning}`,
            },
          ],
        };
      },
    );
  }

  return server;
}
