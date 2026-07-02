// `bun run kb:verify [<id>...] [--strict] [--json]` — curation tooling that classifies
// each ACTIVE knowledge entry fresh / stale / unverifiable from its `source` string +
// git history. The pure policy lives in @objectcore/knowledge (parseSourceRefs /
// assessStaleness); THIS edge gathers the disk + git evidence and injects `today`
// (the same pure-policy / edge-gathers split the release engine uses).
//
// DELIBERATELY NOT part of `bun run check` / `kb:check`: CI clones are shallow, so
// git-dated staleness would be wrong exactly where the gate runs (plan 013 constraint
// #5). This is a periodic curation runbook, never gate-blocking — exit is non-zero
// only under --strict when something is stale (or on a usage/argument error).

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  FileKnowledgeStore,
  isActive,
  parseSourceRefs,
  assessStaleness,
  type KnowledgeEntry,
  type PathEvidence,
  type StalenessAssessment,
} from "@objectcore/knowledge";

const root = join(import.meta.dir, "..");
const kbDir = join(root, "knowledge");

const argv = process.argv.slice(2);
const strict = argv.includes("--strict");
const asJson = argv.includes("--json");
const requestedIds = argv.filter((a) => !a.startsWith("--"));

function fail(msg: string): never {
  console.error(`[error] ${msg}`);
  console.error("\n✗ kb:verify failed.");
  process.exit(1);
}

/** `git log -1 --format=%cs -- <path>` → the last committer date (YYYY-MM-DD), or
 *  undefined when git is absent / this isn't a repo / the path has no history (a
 *  shallow CI clone lands here too — which is exactly why this never runs in the gate). */
function gitLastModified(cwd: string, path: string): string | undefined {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cs", "--", path], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || undefined;
  } catch {
    return undefined; // tolerated — evidence simply carries no lastModified
  }
}

// today: local ISO date, injected ONCE. The v1 policy is anchor-relative (no max-age),
// so today is currently inert — passed for purity + a future max-age extension.
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
  now.getDate(),
).padStart(2, "0")}`;

const store = new FileKnowledgeStore(kbDir);
let all: KnowledgeEntry[];
try {
  all = await store.list(); // store.parseEntry normalizes CRLF + labels corrupt files
} catch (e) {
  fail((e as Error).message);
}

const active = all.filter(isActive);

// Positional ids restrict the set; an id that isn't an ACTIVE entry is an error (with
// a helpful note when it exists but is archived — kb:verify covers active entries only).
let selected: KnowledgeEntry[];
if (requestedIds.length) {
  for (const id of requestedIds) {
    if (!active.some((e) => e.id === id)) {
      const archived = all.find((e) => e.id === id);
      fail(
        archived
          ? `entry "${id}" is not active (status: ${archived.status ?? "active"}) — kb:verify covers active entries only`
          : `unknown entry id "${id}"`,
      );
    }
  }
  selected = active.filter((e) => requestedIds.includes(e.id));
} else {
  selected = active;
}

// Gather evidence per PATH ref (URLs are excluded — not disk/git verifiable) and
// assess. Deterministic order: store.list() returns entries sorted by id.
const assessments: StalenessAssessment[] = selected.map((entry) => {
  const pathRefs = parseSourceRefs(entry.source).filter((r) => r.kind === "path");
  const evidence: PathEvidence[] = pathRefs.map((r) => {
    const exists = existsSync(join(root, r.raw));
    // A git date is only meaningful for an EXISTING path: a missing extensioned file
    // is stale on existence alone; a missing shorthand ref is unverifiable.
    const lastModified = exists ? gitLastModified(root, r.raw) : undefined;
    return lastModified !== undefined
      ? { path: r.raw, exists, lastModified }
      : { path: r.raw, exists };
  });
  return assessStaleness(entry, evidence, today);
});

const counts = {
  fresh: assessments.filter((a) => a.freshness === "fresh").length,
  stale: assessments.filter((a) => a.freshness === "stale").length,
  unverifiable: assessments.filter((a) => a.freshness === "unverifiable").length,
};
const summary = `${counts.fresh} fresh, ${counts.stale} stale, ${counts.unverifiable} unverifiable`;

if (asJson) {
  console.log(JSON.stringify(assessments, null, 2));
} else {
  // Table: id | freshness | anchor | reason (reason free-width, last column).
  const idW = Math.max(2, ...assessments.map((a) => a.id.length));
  const frW = Math.max("freshness".length, ...assessments.map((a) => a.freshness.length));
  const anW = Math.max("anchor".length, ...assessments.map((a) => a.anchor.length));
  console.log(
    `kb:verify — ${assessments.length} active entr${assessments.length === 1 ? "y" : "ies"} (today ${today})\n`,
  );
  console.log(`${"id".padEnd(idW)}  ${"freshness".padEnd(frW)}  ${"anchor".padEnd(anW)}  reason`);
  console.log(`${"-".repeat(idW)}  ${"-".repeat(frW)}  ${"-".repeat(anW)}  ${"-".repeat(6)}`);
  for (const a of assessments) {
    console.log(
      `${a.id.padEnd(idW)}  ${a.freshness.padEnd(frW)}  ${a.anchor.padEnd(anW)}  ${a.reason}`,
    );
  }
  console.log("");
  if (strict && counts.stale > 0) {
    console.error(`✗ kb:verify: ${summary} — ${counts.stale} stale under --strict.`);
  } else {
    console.log(`✓ kb:verify: ${summary}.`);
  }
}

// Exit 1 ONLY under --strict when ≥1 stale (curation tooling — informational otherwise).
if (strict && counts.stale > 0) process.exit(1);
