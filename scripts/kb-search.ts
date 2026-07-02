// `bun run kb:search "<query>" [--k 5] [--type <t>] [--tag <t>] [--all] [--json]`
// Deterministic lexical retrieval over the knowledge base — the query surface WP3
// adds on top of the startup INDEX load (plan 013). The pure ranking lives in
// @objectcore/knowledge (`searchEntries`); this is the disk edge (FileKnowledgeStore)
// + presentation. `--all` includes archived (superseded/deprecated) entries.

import { join } from "node:path";
import { FileKnowledgeStore, searchEntries, ENTRY_TYPES } from "@objectcore/knowledge";
import type { EntryType, SearchOptions } from "@objectcore/knowledge";

const args = process.argv.slice(2);

function fail(msg: string): never {
  console.error(`✗ kb:search failed: ${msg}`);
  process.exit(1);
}

/** The value immediately after `flag`, or undefined; rejects a following flag. */
function flagArg(flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith("--") ? v : undefined;
}

// The query is the first non-flag argument (value-taking flags skip their value).
const VALUE_FLAGS = new Set(["--k", "--type", "--tag"]);
let query: string | undefined;
for (let i = 0; i < args.length; i++) {
  const a = args[i] as string;
  if (a.startsWith("--")) {
    if (VALUE_FLAGS.has(a)) i++; // skip its value
    continue;
  }
  query = a;
  break;
}
if (!query) {
  console.error(
    'usage: bun run kb:search "<query>" [--k 5] [--type <lesson|pattern|gotcha|decision>] [--tag <t>] [--all] [--json]',
  );
  process.exit(2);
}

const opts: SearchOptions = { includeArchived: args.includes("--all") };

const kRaw = flagArg("--k");
if (kRaw !== undefined) {
  const k = Number(kRaw);
  if (!Number.isInteger(k) || k <= 0) fail(`--k must be a positive integer (got "${kRaw}")`);
  opts.k = k;
}

const type = flagArg("--type");
if (type !== undefined) {
  if (!ENTRY_TYPES.includes(type as EntryType)) {
    fail(`--type must be one of ${ENTRY_TYPES.join(", ")} (got "${type}")`);
  }
  opts.type = type as EntryType;
}

const tag = flagArg("--tag");
if (tag !== undefined) opts.tag = tag;

const root = join(import.meta.dir, "..");
const store = new FileKnowledgeStore(join(root, "knowledge"));
const entries = await store.list();
const hits = searchEntries(entries, query, opts);

if (args.includes("--json")) {
  console.log(
    JSON.stringify(
      hits.map((h) => ({
        id: h.id,
        score: Number(h.score.toFixed(3)),
        title: h.entry.title,
        type: h.entry.type,
      })),
      null,
      2,
    ),
  );
  process.exit(0);
}

if (!hits.length) {
  console.log(`No matching knowledge entries for "${query}".`);
  process.exit(0);
}

// Table: rank | id | score(3dp) | title, columns padded to their widest cell.
const rows = hits.map((h, i) => ({
  rank: String(i + 1),
  id: h.id,
  score: h.score.toFixed(3),
  title: h.entry.title,
}));
const w = (key: "rank" | "id" | "score") =>
  Math.max(key.length, ...rows.map((r) => r[key].length));
const wRank = w("rank");
const wId = w("id");
const wScore = w("score");
console.log(
  `${"rank".padEnd(wRank)}  ${"id".padEnd(wId)}  ${"score".padStart(wScore)}  title`,
);
for (const r of rows) {
  console.log(
    `${r.rank.padEnd(wRank)}  ${r.id.padEnd(wId)}  ${r.score.padStart(wScore)}  ${r.title}`,
  );
}
