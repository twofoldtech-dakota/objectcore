// `bun run kb:add --json '<KnowledgeEntryInput>'` (or `--json @file.json`)
// Append a lesson to the knowledge base and regenerate INDEX.md. This is the
// programmatic write path the self-improving loop (F2 hook / F3 reflection
// subagent) will call; humans can also use `/remember` (knowledge-base plugin).

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { FileKnowledgeStore, type KnowledgeEntryInput } from "@objectcore/knowledge";

const args = process.argv.slice(2);
const ji = args.indexOf("--json");
if (ji === -1 || !args[ji + 1]) {
  console.error(
    'usage: bun run kb:add --json \'{"type":"lesson","title":"...","body":"..."}\'  (or --json @file.json)',
  );
  process.exit(2);
}

const raw = args[ji + 1];
const json = raw.startsWith("@") ? readFileSync(raw.slice(1), "utf8") : raw;
const input = JSON.parse(json) as KnowledgeEntryInput;

const root = join(import.meta.dir, "..");
const store = new FileKnowledgeStore(join(root, "knowledge"));
const entry = await store.append(input);
console.log(`✓ added knowledge entry "${entry.id}" (${entry.type}); INDEX.md regenerated.`);
