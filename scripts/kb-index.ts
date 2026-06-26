// `bun run kb:index` — regenerate knowledge/INDEX.md from the entries on disk.
// INDEX.md is a build artifact (like marketplace.json); never hand-edit it.

import { join } from "node:path";
import { FileKnowledgeStore } from "@objectcore/knowledge";

const root = join(import.meta.dir, "..");
const store = new FileKnowledgeStore(join(root, "knowledge"));
const text = await store.writeIndex();
console.log(`✓ wrote knowledge/INDEX.md (${text.split("\n").length} lines)`);
