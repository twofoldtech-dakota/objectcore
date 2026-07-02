// `bun run kb:add --json '<KnowledgeEntryInput>'` (or `--json @file.json`)
// Append a lesson to the knowledge base and regenerate INDEX.md. This is the
// programmatic write path the self-improving loop (F2 hook / F3 reflection
// subagent) will call; humans can also use `/remember` (knowledge-base plugin).

import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  FileKnowledgeStore,
  findNearDuplicates,
  isActive,
  type KnowledgeEntryInput,
} from "@objectcore/knowledge";

const args = process.argv.slice(2);
const ji = args.indexOf("--json");
if (ji === -1 || !args[ji + 1]) {
  console.error(
    'usage: bun run kb:add --json \'{"type":"lesson","title":"...","body":"..."}\'  (or --json @file.json) [--force]',
  );
  process.exit(2);
}

// --force skips the write-time near-duplicate refusal (plan 013 WP4) — a deliberate,
// authored override, never the default path.
const force = args.includes("--force");

const raw = args[ji + 1];
const json = raw.startsWith("@") ? readFileSync(raw.slice(1), "utf8") : raw;
const input = JSON.parse(json) as KnowledgeEntryInput;

const root = join(import.meta.dir, "..");
const store = new FileKnowledgeStore(join(root, "knowledge"));

// Write-time dedup (plan 013 WP4): refuse a new entry that near-duplicates an ACTIVE
// one, listing the matches and pointing at update/supersede. Enforced HERE at the CLI
// edge, never inside the store (the port stays a storage seam; --force is a CLI concern).
if (!force) {
  const active = (await store.list()).filter(isActive);
  const dups = findNearDuplicates(
    { title: input.title, tags: input.tags, body: input.body },
    active,
  );
  if (dups.length) {
    for (const d of dups) {
      console.error(
        `✗ near-duplicate of "${d.id}" (score ${d.score.toFixed(2)}) — update or supersede it (bun run kb:curate), or pass --force`,
      );
    }
    process.exit(1);
  }
}

try {
  const entry = await store.append(input);
  console.log(`✓ added knowledge entry "${entry.id}" (${entry.type}); INDEX.md regenerated.`);
} catch (e) {
  // The store rejects frontmatter-breaking fields BEFORE writing — surface the
  // reason cleanly so the caller (often the reflection loop) can fix the input.
  console.error(`✗ kb:add failed: ${(e as Error).message}`);
  process.exit(1);
}
