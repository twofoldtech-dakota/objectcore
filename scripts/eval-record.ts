// `bun run eval:record [--note "..."] [--if-changed]` — append the latest gate-health
// score to the longitudinal log (metrics/eval-history.jsonl, git-tracked). Run AFTER
// `bun run eval` / `bun run check` (which writes dist/eval-score.json). Ideally run in CI
// on a merge to main so the trend reflects shipped checkpoints; run locally the judge is
// skipped, so the graded fields are thin — note that in the entry.
//
// `--if-changed` skips the append when the score is identical to the last recorded entry
// (so the CI workflow logs inflection points, not an entry per merge).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseHistory,
  scoresEqual,
  serializeEntry,
  type EvalScore,
  type ScoreHistoryEntry,
} from "@objectcore/eval";

const root = join(import.meta.dir, "..");

let score: EvalScore;
try {
  score = JSON.parse(readFileSync(join(root, "dist", "eval-score.json"), "utf8")) as EvalScore;
} catch {
  console.error("no dist/eval-score.json — run `bun run eval` (or `bun run check`) first.");
  process.exit(2);
}

const argv = process.argv.slice(2);
const ni = argv.indexOf("--note");
const note = ni !== -1 ? argv[ni + 1] : undefined;
const ifChanged = argv.includes("--if-changed");

let commit: string | undefined;
try {
  commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
} catch {
  /* not a git checkout — leave commit undefined */
}

const entry: ScoreHistoryEntry = {
  recordedAt: new Date().toISOString(),
  ...(commit ? { commit } : {}),
  ...(note ? { note } : {}),
  score,
};

const histPath = join(root, "metrics", "eval-history.jsonl");
mkdirSync(join(root, "metrics"), { recursive: true });
const prefix = existsSync(histPath) ? readFileSync(histPath, "utf8") : "";

if (ifChanged && prefix.trim()) {
  const existing = parseHistory(prefix);
  const last = existing[existing.length - 1];
  if (last && scoresEqual(last.score, score)) {
    console.log(
      `score unchanged vs last entry (health ${score.health.toFixed(3)}) — not recording (--if-changed).`,
    );
    process.exit(0);
  }
}

const sep = prefix.length && !prefix.endsWith("\n") ? "\n" : "";
writeFileSync(histPath, prefix + sep + serializeEntry(entry) + "\n", "utf8");

console.log(
  `✓ recorded health ${score.health.toFixed(3)} (graded ${score.graded}, commit ${commit ?? "n/a"})` +
    ` to metrics/eval-history.jsonl`,
);
