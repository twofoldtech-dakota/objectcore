// `bun run eval:trend` — print the longitudinal gate-health trend from the tracked log
// (metrics/eval-history.jsonl). Read-only; answers OQ4's longitudinal question ("is the
// factory getting healthier over time?") from the recorded history.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatHistorySummary, parseHistory, summarizeHistory } from "@objectcore/eval";

const root = join(import.meta.dir, "..");
let jsonl = "";
try {
  jsonl = readFileSync(join(root, "metrics", "eval-history.jsonl"), "utf8");
} catch {
  /* no history yet — summarize an empty set */
}

console.log(formatHistorySummary(summarizeHistory(parseHistory(jsonl))));
