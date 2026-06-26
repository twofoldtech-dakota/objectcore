#!/usr/bin/env bun
// SessionStart hook (kb-writer): surface the project's knowledge-base index into
// session context so prior lessons inform the work. A SessionStart command hook's
// stdout is added to the session context. Reads $CLAUDE_PROJECT_DIR/knowledge/
// INDEX.md (the consuming project's KB — in ObjectCore that's our own); silent
// no-op if the project has no knowledge base.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
try {
  const index = readFileSync(join(projectDir, "knowledge", "INDEX.md"), "utf8");
  console.log(
    "# Project knowledge base — prior lessons (read before acting)\n\n" +
      index +
      "\nOpen an entry under knowledge/entries/<id>.md on demand; capture new durable lessons with `bun run kb:add`.",
  );
} catch {
  // No knowledge/ in this project — nothing to surface.
}
