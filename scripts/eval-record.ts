// `bun run eval:record [--note "..."] [--if-changed] [--force]` — append the latest
// gate-health score to the longitudinal log (metrics/eval-history.jsonl, git-tracked).
// Run AFTER `bun run eval` / `bun run check` (which writes dist/eval-score.json).
// Ideally run in CI on a merge to main so the trend reflects shipped checkpoints.
//
// `--if-changed` skips the append when the score is identical to the last recorded entry
// (so the CI workflow logs inflection points, not an entry per merge).
//
// Gradedness guard: a keyless run grades zero activation/delegation cases, so its
// health is computed over a different denominator than a keyed run — mixing the two
// makes the OQ4 trend read environment drift as regression/improvement. Recording a
// run whose gradedness differs from the last entry is refused unless `--force`
// (which stamps an "ungraded run" note when forcing a keyless score in).

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
const noteArg = ni !== -1 ? argv[ni + 1] : undefined;
const ifChanged = argv.includes("--if-changed");
const force = argv.includes("--force");

let commit: string | undefined;
try {
  commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
} catch {
  /* not a git checkout — leave commit undefined */
}

const histPath = join(root, "metrics", "eval-history.jsonl");
mkdirSync(join(root, "metrics"), { recursive: true });
const prefix = existsSync(histPath) ? readFileSync(histPath, "utf8") : "";
const existing = prefix.trim() ? parseHistory(prefix) : [];
const last = existing[existing.length - 1];

// Refuse to mix graded and ungraded runs (see header) — the denominators differ,
// so summarizeHistory/compareScores would report environment, not interventions.
if (last && (last.score.graded > 0) !== (score.graded > 0) && !force) {
  console.error(
    `gradedness mismatch: last entry graded=${last.score.graded}, this run graded=${score.graded} — ` +
      `a mixed record would poison the trend. Set ANTHROPIC_API_KEY and re-run \`bun run eval\`, ` +
      `or pass --force to record anyway.`,
  );
  process.exit(2);
}
const note =
  force && score.graded === 0 ? `${noteArg ? noteArg + "; " : ""}ungraded run` : noteArg;

const entry: ScoreHistoryEntry = {
  recordedAt: new Date().toISOString(),
  ...(commit ? { commit } : {}),
  ...(note ? { note } : {}),
  score,
};

if (ifChanged && last && scoresEqual(last.score, score)) {
  console.log(
    `score unchanged vs last entry (health ${score.health.toFixed(3)}) — not recording (--if-changed).`,
  );
  process.exit(0);
}

const sep = prefix.length && !prefix.endsWith("\n") ? "\n" : "";
writeFileSync(histPath, prefix + sep + serializeEntry(entry) + "\n", "utf8");

console.log(
  `✓ recorded health ${score.health.toFixed(3)} (graded ${score.graded}, commit ${commit ?? "n/a"})` +
    ` to metrics/eval-history.jsonl`,
);
