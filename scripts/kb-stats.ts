// `bun run kb:stats [--json] [--fast]` — the periodic curation runbook (plan 013 WP5):
// join every KB entry × its citations (metrics/kb-usage.jsonl) × its WP2 staleness, and
// rank ACTIVE prune candidates worst-first (stale → never-cited → oldest anchor).
//
// Read-only. Reuses the WP2 pure policy (parseSourceRefs / assessStaleness) with the
// SAME disk+git evidence-gathering the kb:verify edge uses (copied here, not shared, so
// kb-verify.ts stays untouched). `--fast` skips ALL git subprocesses (the freshness
// column then shows `-`). The eval-history linkage is prose-level only: `kb:stats` reads
// metrics/eval-history.jsonl as a plain file to surface any `lesson:<id>` note refs — it
// never touches @objectcore/eval.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FileKnowledgeStore,
  isActive,
  parseSourceRefs,
  assessStaleness,
  parseUsageLog,
  aggregateUsage,
  type KnowledgeEntry,
  type PathEvidence,
  type Freshness,
} from "@objectcore/knowledge";

const root = join(import.meta.dir, "..");
const kbDir = join(root, "knowledge");

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const fast = argv.includes("--fast");

function fail(msg: string): never {
  console.error(`[error] ${msg}`);
  console.error("\n✗ kb:stats failed.");
  process.exit(1);
}

// today: local ISO date, injected ONCE (same computation as kb:verify). Used both as
// the staleness `today` and as the age-days reference.
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
  now.getDate(),
).padStart(2, "0")}`;

/** `git log -1 --format=%cs -- <path>` → last committer date (YYYY-MM-DD), or undefined
 *  when git is absent / not a repo / the path has no history (a shallow clone lands here
 *  too). Copied from scripts/kb-verify.ts — deliberately not shared, to leave it untouched. */
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

/** Integer days from an entry's `created` date to `today` (both YYYY-MM-DD, compared at
 *  UTC midnight so the diff is a whole number of days regardless of local timezone). */
function ageDays(created: string): number {
  const a = Date.parse(`${created}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

const store = new FileKnowledgeStore(kbDir);
let all: KnowledgeEntry[];
try {
  all = await store.list(); // ALL entries (active + archived); sorted by id
} catch (e) {
  fail((e as Error).message);
}

// Usage log (CRLF-tolerant via parseUsageLog); absent → no citations yet.
const usagePath = join(root, "metrics", "kb-usage.jsonl");
let usage: Map<string, { id: string; cited: number; lastCited?: string }>;
try {
  const usageText = existsSync(usagePath) ? readFileSync(usagePath, "utf8") : "";
  usage = aggregateUsage(usageText.trim() ? parseUsageLog(usageText) : []);
} catch (e) {
  fail(`metrics/kb-usage.jsonl: ${(e as Error).message}`);
}

interface Row {
  entry: KnowledgeEntry;
  status: string;
  ageDays: number;
  cited: number;
  lastCited?: string;
  anchor: string; // verifiedAt ?? updated ?? created
  freshness: Freshness | "-";
}

const rows: Row[] = all.map((entry) => {
  const stats = usage.get(entry.id);
  const anchor = entry.verifiedAt ?? entry.updated ?? entry.created;
  let freshness: Freshness | "-" = "-";
  if (!fast) {
    // Gather disk+git evidence per PATH ref (URLs excluded — not disk/git verifiable),
    // then run the pure WP2 policy. Same shape as kb:verify's edge.
    const pathRefs = parseSourceRefs(entry.source).filter((r) => r.kind === "path");
    const evidence: PathEvidence[] = pathRefs.map((r) => {
      const exists = existsSync(join(root, r.raw));
      const lastModified = exists ? gitLastModified(root, r.raw) : undefined;
      return lastModified !== undefined
        ? { path: r.raw, exists, lastModified }
        : { path: r.raw, exists };
    });
    freshness = assessStaleness(entry, evidence, today).freshness;
  }
  return {
    entry,
    status: entry.status ?? "active",
    ageDays: ageDays(entry.created),
    cited: stats?.cited ?? 0,
    lastCited: stats?.lastCited,
    anchor,
    freshness,
  };
});

// --- prune candidates: ACTIVE only, ranked worst-first ---
// stale first → then never-cited → then oldest anchor (id asc as the deterministic tie).
const pruneRanked = rows
  .filter((r) => isActive(r.entry))
  .slice()
  .sort((a, b) => {
    const aStale = a.freshness === "stale" ? 0 : 1;
    const bStale = b.freshness === "stale" ? 0 : 1;
    if (aStale !== bStale) return aStale - bStale;
    const aNever = a.cited === 0 ? 0 : 1;
    const bNever = b.cited === 0 ? 0 : 1;
    if (aNever !== bNever) return aNever - bNever;
    if (a.anchor !== b.anchor) return a.anchor < b.anchor ? -1 : 1;
    return a.entry.id.localeCompare(b.entry.id);
  });

function pruneReason(r: Row): string {
  const parts: string[] = [];
  if (r.freshness === "stale") parts.push("stale");
  parts.push(r.cited === 0 ? "never cited" : `cited ${r.cited}×`);
  parts.push(`anchor ${r.anchor} (${r.ageDays}d)`);
  return parts.join("; ");
}

const topPrune = pruneRanked.slice(0, 5);

// --- eval-history lesson refs (prose-level linkage; read as a plain file) ---
// Scan `note` fields for `lesson:<id>` refs. Tolerate malformed lines (another tool's log).
const lessonRefs = new Map<string, number>();
const histPath = join(root, "metrics", "eval-history.jsonl");
if (existsSync(histPath)) {
  for (const line of readFileSync(histPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(t);
    } catch {
      continue; // skip malformed — it's another tool's append-only log
    }
    const note =
      obj && typeof obj === "object" && typeof (obj as { note?: unknown }).note === "string"
        ? (obj as { note: string }).note
        : "";
    for (const m of note.matchAll(/lesson:([a-z0-9]+(?:-[a-z0-9]+)*)/g)) {
      const lid = m[1]!;
      lessonRefs.set(lid, (lessonRefs.get(lid) ?? 0) + 1);
    }
  }
}

// --- output ---
if (asJson) {
  console.log(
    JSON.stringify(
      {
        today,
        entries: rows.map((r) => ({
          id: r.entry.id,
          type: r.entry.type,
          status: r.status,
          ageDays: r.ageDays,
          cited: r.cited,
          lastCited: r.lastCited ?? null,
          freshness: r.freshness,
        })),
        pruneCandidates: topPrune.map((r) => ({ id: r.entry.id, reason: pruneReason(r) })),
        lessonsReferenced: [...lessonRefs].map(([id, count]) => ({ id, count })),
      },
      null,
      2,
    ),
  );
} else {
  const cols = rows.map((r) => ({
    id: r.entry.id,
    type: r.entry.type,
    status: r.status,
    age: String(r.ageDays),
    cited: String(r.cited),
    lastCited: r.lastCited ? r.lastCited.slice(0, 10) : "-",
    freshness: r.freshness,
  }));
  const w = {
    id: Math.max("id".length, ...cols.map((c) => c.id.length)),
    type: Math.max("type".length, ...cols.map((c) => c.type.length)),
    status: Math.max("status".length, ...cols.map((c) => c.status.length)),
    age: Math.max("age(d)".length, ...cols.map((c) => c.age.length)),
    cited: Math.max("cited".length, ...cols.map((c) => c.cited.length)),
    lastCited: Math.max("last-cited".length, ...cols.map((c) => c.lastCited.length)),
    freshness: Math.max("freshness".length, ...cols.map((c) => c.freshness.length)),
  };
  const totalCited = rows.reduce((n, r) => n + r.cited, 0);
  console.log(
    `kb:stats — ${rows.length} entr${rows.length === 1 ? "y" : "ies"} (${
      rows.filter((r) => isActive(r.entry)).length
    } active), ${totalCited} citation${totalCited === 1 ? "" : "s"}${
      fast ? ", --fast (freshness skipped)" : ""
    } (today ${today})\n`,
  );
  console.log(
    `${"id".padEnd(w.id)}  ${"type".padEnd(w.type)}  ${"status".padEnd(w.status)}  ${"age(d)".padEnd(
      w.age,
    )}  ${"cited".padEnd(w.cited)}  ${"last-cited".padEnd(w.lastCited)}  ${"freshness".padEnd(
      w.freshness,
    )}`,
  );
  console.log(
    `${"-".repeat(w.id)}  ${"-".repeat(w.type)}  ${"-".repeat(w.status)}  ${"-".repeat(
      w.age,
    )}  ${"-".repeat(w.cited)}  ${"-".repeat(w.lastCited)}  ${"-".repeat(w.freshness)}`,
  );
  for (const c of cols) {
    console.log(
      `${c.id.padEnd(w.id)}  ${c.type.padEnd(w.type)}  ${c.status.padEnd(w.status)}  ${c.age.padEnd(
        w.age,
      )}  ${c.cited.padEnd(w.cited)}  ${c.lastCited.padEnd(w.lastCited)}  ${c.freshness.padEnd(
        w.freshness,
      )}`,
    );
  }

  console.log("\nprune candidates:");
  if (!topPrune.length) {
    console.log("  (none — no active entries)");
  } else {
    for (const r of topPrune) {
      console.log(`  ${r.entry.id} — ${pruneReason(r)}`);
    }
  }

  if (lessonRefs.size) {
    const refs = [...lessonRefs].map(([id, n]) => `${id} (${n})`).join(", ");
    console.log(`\nlessons referenced in eval history: ${refs}`);
  }
}
