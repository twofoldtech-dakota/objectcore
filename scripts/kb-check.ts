// `bun run kb:check` — read-only gate over the knowledge base, the KB's analogue
// of check:catalog. Parses every entry (fails on malformed frontmatter), asserts
// the committed INDEX.md byte-matches a fresh derivation (so a hand-edit or a
// forgotten `kb:index` fails), and asserts the index is within its budget. Part
// of `bun run check`.

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { FileKnowledgeStore, renderIndex, checkIndexBudget } from "@objectcore/knowledge";

const root = join(import.meta.dir, "..");
const kbDir = join(root, "knowledge");
const store = new FileKnowledgeStore(kbDir);

const errors: string[] = [];

// 1) Parse every entry — a corrupt file is reported by name (the store labels
// parse failures with the file path), not as a bare stack trace.
let entries;
try {
  entries = await store.list();
} catch (e) {
  console.error(`[error] ${(e as Error).message}`);
  console.error("\n✗ kb:check failed.");
  process.exit(1);
}

// 2) Committed INDEX.md must match a fresh render (CRLF-normalized — unlike
// check:catalog, which is strict-byte and diagnoses CRLF drift explicitly).
const expected = renderIndex(entries);
let committed = "";
try {
  committed = await readFile(join(kbDir, "INDEX.md"), "utf8");
} catch {
  committed = "";
}
if (committed.replace(/\r\n/g, "\n") !== expected) {
  errors.push("knowledge/INDEX.md is out of sync with entries/ — run `bun run kb:index`");
}

// 3) Budget — overflow is the curate/prune signal.
const budget = checkIndexBudget(expected);
if (!budget.ok) {
  errors.push(
    `INDEX.md over budget (${budget.lines} lines / ${budget.bytes} bytes; max ${200}/${25 * 1024}) — curate or prune entries`,
  );
}

if (errors.length) {
  for (const e of errors) console.error(`[error] ${e}`);
  console.error("\n✗ kb:check failed.");
  process.exit(1);
}
console.log(`✓ kb:check: ${entries.length} entries, INDEX.md in sync and within budget.`);
