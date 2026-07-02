// Usage / ROI signal for the knowledge base (plan 013 WP5). PURE — parse / serialize /
// aggregate only; the JSONL file I/O lives at the script edges (scripts/kb-cite.ts,
// scripts/kb-stats.ts), exactly like staleness.ts keeps git/disk out of the core.
//
// Storage is append-only git-tracked `metrics/kb-usage.jsonl` — the
// `metrics/eval-history.jsonl` precedent (union-merge-friendly, durable, timestamped) —
// NOT frontmatter counters (which churn entry files per citation, breed merge conflicts,
// grow the round-trip guard, and carry no timestamps).

/** A single recorded citation of a KB entry. `citedAt` is a full ISO instant (unlike
 *  the YYYY-MM-DD dates on entries) so a burst of same-day cites stays ordered. */
export interface UsageEvent {
  /** ISO instant (`new Date().toISOString()`) the entry was cited. */
  citedAt: string;
  /** The cited entry's kebab id. */
  id: string;
  /** Optional provenance of the citation (e.g. `reflection:<failure>`). */
  source?: string;
}

/** The known keys — reject-unknown posture, mirroring registry-core's `validateSchema`
 *  and the KB's own known-key allowlist on entry frontmatter. */
const KNOWN_KEYS: readonly string[] = ["citedAt", "id", "source"];

/** Same kebab rule the store applies to entry ids (registry-core's slug rule). A logged
 *  id always resolved through `store.get` at write time, so this never rejects real data. */
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Parse the usage log. Splits on `/\r?\n/` (CRLF-tolerant, the `kb:check` precedent),
 *  skips blank lines, and throws with the 1-based PHYSICAL line number (blanks counted,
 *  so the number points at the real file line) on bad JSON or a bad shape. */
export function parseUsageLog(text: string): UsageEvent[] {
  const out: UsageEvent[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue; // skip blank lines
    const lineNo = i + 1;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      throw new Error(`kb-usage.jsonl line ${lineNo}: invalid JSON (${(e as Error).message})`);
    }
    out.push(validateEvent(obj, lineNo));
  }
  return out;
}

/** Strict shape check for one parsed line. Rejects unknown keys, a missing/blank
 *  `citedAt`, and a missing/non-kebab `id`; `source` is optional but must be a string. */
function validateEvent(obj: unknown, lineNo: number): UsageEvent {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw new Error(`kb-usage.jsonl line ${lineNo}: expected a JSON object`);
  }
  const rec = obj as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (!KNOWN_KEYS.includes(key)) {
      throw new Error(`kb-usage.jsonl line ${lineNo}: unknown key "${key}"`);
    }
  }
  const { citedAt, id, source } = rec;
  if (typeof citedAt !== "string" || citedAt.length === 0) {
    throw new Error(`kb-usage.jsonl line ${lineNo}: "citedAt" must be a non-empty string`);
  }
  if (typeof id !== "string" || !KEBAB.test(id)) {
    throw new Error(`kb-usage.jsonl line ${lineNo}: "id" must be a kebab-case string`);
  }
  if (source !== undefined && typeof source !== "string") {
    throw new Error(`kb-usage.jsonl line ${lineNo}: "source" must be a string`);
  }
  return source !== undefined ? { citedAt, id, source } : { citedAt, id };
}

/** Serialize one event to a single JSON line with a STABLE key order
 *  (`citedAt`, `id`, `source?`) so the append is deterministic and diffs are clean. */
export function serializeUsageEvent(e: UsageEvent): string {
  const obj: { citedAt: string; id: string; source?: string } = { citedAt: e.citedAt, id: e.id };
  if (e.source !== undefined) obj.source = e.source;
  return JSON.stringify(obj);
}

/** Aggregate stats for one entry: total citations + the most recent `citedAt`. */
export interface UsageStats {
  id: string;
  cited: number;
  /** The maximum `citedAt` seen for this id (ISO instants sort lexically). */
  lastCited?: string;
}

/** Fold a flat event list into per-id stats: `cited` = count, `lastCited` = max citedAt.
 *  Insertion order is first-seen; callers that need a stable table sort by id themselves. */
export function aggregateUsage(events: UsageEvent[]): Map<string, UsageStats> {
  const map = new Map<string, UsageStats>();
  for (const e of events) {
    const cur = map.get(e.id);
    if (cur === undefined) {
      map.set(e.id, { id: e.id, cited: 1, lastCited: e.citedAt });
    } else {
      cur.cited += 1;
      if (cur.lastCited === undefined || e.citedAt > cur.lastCited) cur.lastCited = e.citedAt;
    }
  }
  return map;
}
