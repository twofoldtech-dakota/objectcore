// `bun run kb:cite <id> [--source "<ref>"]` — record a citation of a KB entry to the
// append-only, git-tracked usage log (metrics/kb-usage.jsonl). The KB's usage/ROI
// signal (plan 013 WP5), consumed by `bun run kb:stats` to rank prune candidates.
//
// The id MUST resolve via store.get — citing a ghost is a bug (✗ + exit 1). Citing a
// since-archived (superseded/deprecated) entry warns but still appends: history is
// history. Append mechanics mirror scripts/eval-record.ts (read first, guard a missing
// trailing newline); the file is born on first cite and never committed empty.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  FileKnowledgeStore,
  isActive,
  serializeUsageEvent,
  type UsageEvent,
} from "@objectcore/knowledge";

const root = join(import.meta.dir, "..");
const argv = process.argv.slice(2);

// Parse: one positional id, plus an optional `--source <ref>` value flag.
const positional: string[] = [];
let source: string | undefined;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a === "--source") {
    source = argv[++i];
  } else if (!a.startsWith("--")) {
    positional.push(a);
  }
}

const id = positional[0];
if (!id) {
  console.error('usage: bun run kb:cite <id> [--source "<ref>"]');
  process.exit(2);
}
// Normalize an empty/whitespace source to "no source" (the store's `|| undefined` rule).
const src = source && source.trim() ? source : undefined;

const store = new FileKnowledgeStore(join(root, "knowledge"));

// The id must resolve — corrupt entries throw (labeled), a missing entry is null.
let entry;
try {
  entry = await store.get(id);
} catch (e) {
  console.error(`✗ kb:cite failed: ${(e as Error).message}`);
  process.exit(1);
}
if (!entry) {
  console.error(`✗ kb:cite failed: unknown entry "${id}" — cite an existing entry id`);
  process.exit(1);
}
if (!isActive(entry)) {
  // Warn but still append — a citation of a since-archived entry is real history.
  console.warn(`[warn] citing archived entry ${id}`);
}

const event: UsageEvent = src ? { citedAt: new Date().toISOString(), id, source: src } : {
  citedAt: new Date().toISOString(),
  id,
};

// Append one line — mirror eval-record.ts: read the existing file, guard a missing
// trailing newline, create the file (and nothing else) if absent.
const usagePath = join(root, "metrics", "kb-usage.jsonl");
mkdirSync(join(root, "metrics"), { recursive: true });
const prefix = existsSync(usagePath) ? readFileSync(usagePath, "utf8") : "";
const sep = prefix.length && !prefix.endsWith("\n") ? "\n" : "";
writeFileSync(usagePath, prefix + sep + serializeUsageEvent(event) + "\n", "utf8");

console.log(
  `✓ cited "${id}"${src ? ` (source: ${src})` : ""} — appended to metrics/kb-usage.jsonl`,
);
