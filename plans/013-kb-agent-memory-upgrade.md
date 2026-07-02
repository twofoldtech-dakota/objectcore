# Plan 013: KB / agent-memory upgrade (`@objectcore/knowledge` lifecycle + retrieval + MCP seam)

> **What this is**: an upgrade of the factory's knowledge base — the memory substrate the
> self-improving loop is built on (plan 008 F1–F4) — to close the gaps between it and
> mid-2026 agent-memory state of the art, WITHOUT giving up its rare strengths (git-reviewed
> entries, byte-match-gated INDEX, bounded budget as the rot signal, zero-dep pure core, a
> closed Reflexion loop). Seven work packages, each sized for one executor agent: entry
> **lifecycle** (update/supersede/deprecate — bounded forgetting), **staleness** verification,
> deterministic **retrieval** (+ offline retrieval evals in the gate), write-time **dedup**,
> **usage/ROI** tracking, a **prose/dogfood** pass, and the **MCP resource server** — the
> access seam the `storage-is-a-port` entry promised.
>
> **Research basis**: three exploration passes (2026-07-02) — two full code maps (the
> knowledge package + CLIs; the consumption loop + plan-008/009 status) and one market
> survey (Devin Knowledge/DeepWiki, Cursor Memories, Windsurf Cascade, Claude Code
> auto-memory + the Anthropic memory tool; Mem0, Letta/MemGPT, Zep/Graphiti, LangMem;
> CoALA, Generative Agents scoring, LoCoMo/LongMemEval) — plus a file-verified design pass.
> The gap table below cites the market norms; prior decisions from
> `plans/notes/008-agentic-research-findings.md` are honored, not re-litigated (own KB vs
> auto-memory; Reflexion/EDDOps adoption; DbKnowledgeStore deferred; autonomous executor
> PARKED — every capture path stays git-reviewed).
>
> **Drift check (run first)**: `bun run check` green + `git status` clean. Re-read
> `packages/knowledge/src/{types,frontmatter,file-store,render}.ts`, `scripts/kb-{add,index,check}.ts`,
> `plugins/reflection/hooks/on-gate-failure.ts`, and `plugins/kb-writer/hooks/*` if they
> changed shape since this was written — the WP specs below quote their current behavior.

## Status

- **Priority**: P1 (the KB is the substrate of the self-improving loop; every later
  F-roadmap item compounds on its quality).
- **Effort**: L total, but decomposed: WP1 M, WP2 S, WP3 M, WP4 S, WP5 S, WP6 S, WP7 M.
  Each WP is independently shippable and gate-green on its own.
- **Risk**: LOW — everything is additive behind the existing `KnowledgeStore` port. The
  only shared surfaces touched: `scripts/kb-check.ts` (gains offline-deterministic checks
  inside `bun run check`), one plugin hook (`on-gate-failure.ts`, additive on its already-RED
  path), and prose. `deriveCatalog`, the seam, and `packages/eval/**`/`packages/registry-core/**`
  are untouched.
- **Depends on**: nothing in-flight. 008 F1–F4 (built) are the substrate.
- **Built on**: one branch per WP — `feat/kb-lifecycle`, `feat/kb-staleness`,
  `feat/kb-retrieval`, `feat/kb-dedup`, `feat/kb-usage`, `feat/kb-prose`, `feat/kb-mcp`.

## Why this fits ObjectCore (the mapping)

| ObjectCore primitive | This upgrade |
|---|---|
| `marketplace.json` byte-match gate (`check:catalog`) | INDEX.md byte-match gate (`kb:check`) — preserved bit-for-bit by WP1's optional-fields design |
| Zep's "facts get invalidated, never deleted" | `status: superseded` + `supersededBy` — files and git history remain; the INDEX (the loaded context) forgets |
| deterministic `validate.ts` floor vs keyed judge layer | deterministic lexical retrieval + offline retrieval evals vs an at-trigger LLM/embedding reranker |
| `searchCatalog` (pure filter behind the frozen seam) | `searchEntries` (pure scorer behind the `KnowledgeStore` port) — the richer sibling |
| `assessStaleness`-style pure policy / edge gathers (release engine pattern) | `staleness.ts` pure policy; `kb:verify` gathers git evidence at the script edge |
| `metrics/eval-history.jsonl` (OQ4, append-only, git-tracked) | `metrics/kb-usage.jsonl` — the KB's usage log, same mechanics |
| `@objectcore/registry-db` = the ONLY `@libsql/client` dependent | `packages/knowledge-mcp` = the ONLY `@modelcontextprotocol/sdk` dependent; core stays zero-dep |
| the `/v1/marketplace.json` access seam over `CatalogSource` | `kb://index` + `kb://entries/{id}` + `kb_search`/`kb_add` over `KnowledgeStore` |
| sink-gated routes (`events` absent unless injected) | `kb_cite` tool registered only when `usageLogPath` is provided |

## The gap analysis (market norm → remedy)

| Gap vs mid-2026 norm | Who set the norm | Remedy | WP |
|---|---|---|---|
| Append-only; no update/supersede/deprecate | Mem0 ADD/UPDATE/DELETE/NOOP; Zep supersede-don't-delete | lifecycle fields + `update`/`supersede`; active-only INDEX = bounded forgetting | WP1 |
| No valid-time signal (git already gives transaction-time) | Zep/Graphiti bi-temporal model | `verifiedAt` + pure staleness policy + `kb:verify` (git at the edge, NEVER in the CI gate) | WP2 |
| No retrieval/query at all beyond the startup INDEX load | JIT retrieval universal (Anthropic memory tool, Mem0, Letta); hybrid search table stakes | pure lexical `searchEntries` + `kb:search` + offline retrieval evals + red-gate hook augmentation | WP3 |
| No dedup beyond exact id collision | similarity-checked writes (Mem0 consolidation) | `findNearDuplicates` enforced at the CLI edges, `--force` escape | WP4 |
| No usage/ROI signal (OQ4 grades the gate, not the KB) | usage tracking emerging; no vendor ships full ROI | `kb:cite` + `kb:stats` prune ranking + the `eval:record --note "lesson:<id>"` convention | WP5 |
| Capture prose predates all of the above; unstructured provenance | Cursor/Windsurf approval flows; OWASP ASI06 provenance | prose/dogfood pass; `origin: reflection` provenance | WP6 |
| No access seam | MCP-accessible memory is the trend | MCP stdio server: resources + tools over the store | WP7 |

**Deliberate non-adoptions (with re-open triggers)**
- **Embeddings / vector store**: at a curated 15–200-entry scale, retrieval misses are
  curation failures, not ranking failures — and a keyed, non-deterministic gate step is
  exactly what the deterministic-floor doctrine forbids. TRIGGER to re-open: the WP3
  retrieval evals start failing as the corpus grows; the upgrade is an adapter behind the
  same `searchEntries`/`kb_search` API (a `Judge`-port Haiku reranker or an embedding
  store) — a relocation, not a rewrite.
- **Temporal knowledge graph (Graphiti/Neo4j)**: wrong scale + a heavy dependency; the
  useful ideas (supersede-don't-delete, valid-time) are adopted as flat fields instead.
- **Frontmatter usage counters**: rejected in favor of append-only JSONL (WP5) — counters
  rewrite entry files per citation (git churn, merge conflicts, round-trip-guard growth).
- **Autonomous, review-free capture**: everything still lands in the working tree → PRs.
  Plan 009's Pillar-4 spirit (a human reviews every machine write) stands.

## Verified constraints — every executor MUST respect these

(File-verified 2026-07-02; each is load-bearing.)

1. **Byte-identity is the sharpest edge.** `knowledge/INDEX.md` is byte-match gated by
   `kb:check`; the header interpolates `${entries.length} entries.` (`render.ts:21`). All
   new frontmatter fields are OPTIONAL, serialize **after `created`**, and are omitted when
   absent — so the 15 existing entries and the INDEX stay byte-identical until an entry
   actually uses a new field. Active-only rendering emits `N entries.` when 0 archived
   (byte-identical today) and `N entries (M archived).` only when M > 0.
2. **The round-trip guard is an explicit field list** (`roundTrips()`,
   `file-store.ts:106-120`: type/title/source/created/tags/body). EVERY new field must be
   added to the comparison, and `update`/`supersede` must route through the guard pre-write —
   a forgotten field means silent lossy writes.
3. **`parseEntry` silently ignores unknown keys today.** WP1 adds a known-key allowlist
   rejection (the `validateSchema` reject-unknown posture); safe because all live entries
   use only the 6 known keys.
4. **`plugins/reflection/hooks/on-gate-failure.ts` is standalone by design** (node builtins
   only — it ships to consuming projects where workspace packages don't resolve). It must
   NEVER import `@objectcore/knowledge`; WP3 gives it a small inline matcher instead.
5. **No git-based staleness inside `bun run check`.** CI clones are shallow — `git log`
   dates are garbage exactly where the gate runs — and the gate must depend only on repo
   bytes. Staleness lives in `kb:verify`/`kb:stats` only. Everything added to the gate is
   deterministic and offline.
6. **Trigger-surface freeze.** No WP touches any skill/agent `description:` frontmatter —
   descriptions are activation/delegation-gated surfaces (the judge routes on them). Body
   edits are eval-neutral.
7. **TCB untouched.** Nothing under `packages/eval/**` or `packages/registry-core/**`
   changes. The eval linkage is purely the `--note "lesson:<id>"` convention plus reading
   `metrics/eval-history.jsonl` as a plain file.
8. **CRLF.** `knowledge/**` and `metrics/**` are not LF-pinned in `.gitattributes` (and do
   not extend it — its header deliberately scopes it). Every new reader/comparison splits
   on `/\r?\n/` (the existing `kb:check` precedent). Root `bunx tsc` typechecks everything,
   including plugin hooks and new packages, under `strict` + `verbatimModuleSyntax`.
9. **Real `source` values are messy**: composites
   (`plans/008 F4; packages/eval/src/{coverage,delegation}.ts, packages/forge/src/scaffold.ts`),
   trailing parentheticals (`packages/eval/src/coverage.ts (F4)`), URLs, and extensionless
   refs (`plans/008`). WP2's parser is specified against these verbatim shapes.
10. **The Stop-hook prompt text is duplicated** in `plugins/kb-writer/hooks/hooks.json`
    AND `.claude/settings.json` (dogfood wiring). WP6 edits both, verbatim-identical.
    Prompt-type hooks cannot be precondition-gated — tighten wording only.
11. **MCP-only plugins are legitimately ungated** on activation/delegation (`coverage.ts`
    gates only when skills/agents exist). The release provenance gate is double-enforced
    (manifest `mcpServers` + a plugin-dir `.mcp.json` scan) — but those scans look only
    INSIDE plugin dirs, so the repo-root `.mcp.json` WP7 adds for dogfood is safe (none
    exists today).
12. **Worktree gotcha** (from plans/README): an executor worktree is created from the
    session base commit, not live main. Every executor starts with
    `git checkout -B <branch> origin/main && bun install`, verifies base markers on disk
    (for WP2+: `packages/knowledge/src/lifecycle.ts` exists = WP1 merged), and COMMITS its
    work before stopping.

## The shared schema (WP1 lays it; everything else builds on it)

```ts
export type EntryStatus = "active" | "superseded" | "deprecated";
export type EntryOrigin = "manual" | "reflection";

// KnowledgeEntry gains (ALL optional; absent = active/manual — old files never churn):
status?: EntryStatus;      // lifecycle
supersededBy?: string;     // required iff status === "superseded"; must name an existing entry
updated?: string;          // ISO date of last content/lifecycle change (store-stamped)
verifiedAt?: string;       // ISO date a human/agent last confirmed the entry still true
origin?: EntryOrigin;      // who wrote it
links?: string[];          // related entry ids (kebab), serialized like tags: `links: [a, b]`
```

Frontmatter emission order after `created` (each omitted when absent/empty):
`status, supersededBy, updated, verifiedAt, origin, links`.
Rules — enforced at parse where local, at `kb:check` where cross-entry: `superseded` ⇔
`supersededBy` present (target exists, no cycles); dates match `^\d{4}-\d{2}-\d{2}$`;
links are kebab ids that resolve, no self-link; unknown frontmatter keys rejected.

---

## Work packages (each = one executor agent; STOP + gate-green PR per WP)

### WP1 — Lifecycle (foundation; merges FIRST) — effort M — branch `feat/kb-lifecycle`

**Goal**: lifecycle fields + `update(id, patch)` / `supersede(oldId, replacement)` on the
port; active-only INDEX (bounded forgetting); `kb:check` referential integrity; `kb:curate` CLI.

**Files**: modify `packages/knowledge/src/{types,frontmatter,file-store,render,index}.ts`,
`scripts/kb-check.ts`, `package.json` (script `kb:curate`); create `scripts/kb-curate.ts`,
`packages/knowledge/src/lifecycle.ts` (pure `checkLifecycle(entries): string[]`),
`packages/knowledge/test/lifecycle.test.ts` (+ extend the two existing test files).

**Port extension**:

```ts
export interface KnowledgeEntryPatch {
  type?: EntryType; title?: string; tags?: string[];
  source?: string;            // "" clears (mirrors append's `|| undefined` normalization)
  body?: string;
  status?: EntryStatus; supersededBy?: string; verifiedAt?: string;
  origin?: EntryOrigin; links?: string[];
  updated?: string;           // explicit override; otherwise store-stamped (rule below)
}

export interface KnowledgeStore {
  list(): Promise<KnowledgeEntry[]>;
  get(id: string): Promise<KnowledgeEntry | null>;
  append(entry: KnowledgeEntryInput): Promise<KnowledgeEntry>;
  update(id: string, patch: KnowledgeEntryPatch): Promise<KnowledgeEntry>;   // id/created NOT patchable
  supersede(oldId: string, replacement: KnowledgeEntryInput):
    Promise<{ superseded: KnowledgeEntry; replacement: KnowledgeEntry }>;
}
```

**Behavior**:
- `update()` parses the existing entry first (corrupt throws, never clobbered — the same
  property `append` has), applies the patch, stamps `updated = today()` when any of
  type/title/tags/source/body/links/status/supersededBy changed (a verifiedAt-only patch
  does NOT bump `updated`), re-serializes, runs the **extended** round-trip guard, writes,
  then `writeIndex()`.
- `supersede()` validates AND round-trips BOTH forms (replacement + patched old entry)
  before writing either; then writes replacement, writes old
  (`status: superseded`, `supersededBy: <newId>`), then ONE `writeIndex()`. A failure on
  either side leaves no partial state.
- `KnowledgeEntryInput` additionally accepts the new optional fields (so `kb:add` can
  write `origin: "reflection"`).
- `renderIndex` filters to active (`isActive(e)` = status absent or `"active"`); the
  budget counts active only — superseding genuinely reclaims budget. Header per
  constraint #1.
- `parseEntry`: known-key allowlist + per-field validation. `serializeEntry`: guarded
  emission (reuse `fmValue`; links validated kebab, serialized like tags).
- `roundTrips()` gains comparisons for all six new fields.

**CLI** (`bun run kb:curate`, one mode per invocation; `--json` accepts inline or `@file`):

```
kb:curate --supersede <old-id> --json '<KnowledgeEntryInput>'
kb:curate --deprecate <id> [--reason "<text>"]   # appends "> Deprecated (YYYY-MM-DD): <reason>" to the body
kb:curate --verify <id> [<id>...]                # stamps verifiedAt = today
kb:curate --update <id> --json '<KnowledgeEntryPatch>'
```

**kb:check additions (all offline/deterministic)**: field validity (via parse),
`supersededBy` target exists, superseded⇔supersededBy consistency, cycle walk with a
visited set, links resolve / no self-link. Pure logic in `lifecycle.ts`; `kb-check.ts`
just calls it.

**Acceptance**:
- `bun run check` green with **zero entry changes and INDEX.md byte-unchanged**
  (`git status` clean apart from source — the load-bearing criterion).
- Round-trip test populating EVERY new field; a mutation test per field proving the
  guard names it.
- Supersede-failure test proving no partial state.
- `bun run kb:curate --verify storage-is-a-port` → diff touches exactly one entry line;
  INDEX untouched. (Revert before committing, or keep the stamp — either is fine, but the
  PR must state which.)

**Agent briefing**: Extend the zero-dep knowledge package with six optional lifecycle
fields and `update`/`supersede` store methods, preserving byte-identity of all existing
entries and INDEX.md (serialize new fields only after `created`; render active-only with
the archived suffix only when nonzero). The round-trip guard in `file-store.ts` compares
fields explicitly — extend it for every new field and route update/supersede through it
pre-write. Add pure lifecycle integrity checks (dangling/cycle/consistency) called from
`scripts/kb-check.ts`, plus the small `scripts/kb-curate.ts` CLI.

### WP2 — Staleness — effort S — depends WP1 — branch `feat/kb-staleness`

**Goal**: a pure staleness policy + a `kb:verify` edge classifying each active entry
fresh/stale/unverifiable from its `source` + git history. Curation tooling — never
gate-blocking.

**Files**: create `packages/knowledge/src/staleness.ts`,
`packages/knowledge/test/staleness.test.ts`, `scripts/kb-verify.ts`; modify
`packages/knowledge/src/index.ts`, `package.json` (script `kb:verify`).

```ts
// staleness.ts — pure, no I/O, no Date.now (today injected)
export type Freshness = "fresh" | "stale" | "unverifiable";
export interface SourceRef { raw: string; kind: "path" | "url"; }
/** Split on /[;,]/, per fragment take the first whitespace token, strip a trailing
 *  parenthetical, expand ONE level of {a,b}. Path-like = contains "/" and !^https?:. */
export function parseSourceRefs(source: string | undefined): SourceRef[];

export interface PathEvidence { path: string; exists: boolean; lastModified?: string; }
export interface StalenessAssessment { id: string; freshness: Freshness; reason: string; anchor: string; }
export function assessStaleness(entry: KnowledgeEntry, evidence: PathEvidence[], today: string): StalenessAssessment;
```

**Policy (v1, deliberately minimal — no arbitrary max-age constant)**: anchor =
`verifiedAt ?? updated ?? created`. Any extensioned path missing → stale ("source file
missing"); any existing path with `lastModified > anchor` (strict ISO string compare —
timezone-free) → stale ("source changed after last verification"); ≥1 existing path and
none newer → fresh; no path-like refs (URL/prose) or only extensionless-missing
(`plans/008`) → unverifiable.

**Edge** (`kb:verify [<id>...] [--strict] [--json]`): loads active entries, gathers
evidence per path (`existsSync` + `git log -1 --format=%cs -- <path>` via `execFileSync`,
tolerating git absence → no lastModified → unverifiable), prints the table; exit 1 on any
stale only under `--strict`. Per constraint #5, `kb:check` does NOT call any of this.

**Acceptance**: `bun run check` green; `parseSourceRefs` tested against the real corpus
shapes verbatim (the composite semicolon+brace source yields 3 paths; the `(F4)`
parenthetical strips; URLs are `kind: "url"`; `plans/008` is unverifiable); `kb:verify`
classifies all live entries without error; the package stays zero-dep.

**Agent briefing**: Add pure `assessStaleness` + `parseSourceRefs` to the knowledge
package (today injected, no I/O) and a `scripts/kb-verify.ts` edge gathering
file-existence + git-last-modified evidence. Handle the corpus's composite source strings
and trailing parentheticals; extensionless missing paths are unverifiable, not stale. Keep
it out of `kb:check` entirely — CI clones are shallow, so git-dated staleness in the gate
would be wrong.

### WP3 — Retrieval — effort M — depends WP1 — branch `feat/kb-retrieval`

**Goal**: deterministic zero-dep lexical search + `kb:search` + **offline retrieval evals
inside kb:check** + a retrieval-augmented red-gate hook + a search-first reflection step.

**Files**: create `packages/knowledge/src/search.ts`, `packages/knowledge/test/search.test.ts`,
`scripts/kb-search.ts`, `knowledge/evals/retrieval.json`; modify
`packages/knowledge/src/index.ts`, `scripts/kb-check.ts`, `package.json`,
`plugins/reflection/hooks/on-gate-failure.ts`, `plugins/reflection/agents/self-reflection.md`
(**BODY only** — constraint #6).

```ts
export function tokenize(text: string): string[]; // lowercase, split /[^a-z0-9]+/, drop stopwords + len<2
export interface SearchOptions { k?: number; type?: EntryType; tag?: string; includeArchived?: boolean; }
export interface SearchHit { id: string; score: number; entry: KnowledgeEntry; }
export function searchEntries(entries: KnowledgeEntry[], query: string, opts?: SearchOptions): SearchHit[];
```

**Scoring**: per-entry weighted token bag (title ×3, tags ×2, id ×2, body ×1); BM25-style
IDF `ln(1 + (N - df + 0.5)/(df + 0.5))` with df over the filtered pool; saturated tf
`wtf/(wtf+1)`; a ~30-word embedded stopword set; hits require score > 0; sort score desc
then **id asc** (the deterministic tie-break). Same corpus + same query → identical
ranking — this determinism is what makes the retrieval evals gate-safe.

**Retrieval evals**: `knowledge/evals/retrieval.json` =
`{ "cases": [{ "query": "...", "expectTop": "<id>" | null, "note": "..." }] }` — ~8–10
cases against the live corpus (e.g. "subagent tools array spawn bug" →
`subagent-tools-comma-serialization`; "hand-editing the generated index" →
`index-is-a-build-artifact`; a "capital of France"-class negative → `null`). `kb:check`
runs them via `searchEntries` and fails on mismatch. Absent file → reported
"retrieval evals: none" (kb:check stays generic), but the file ships in this WP.

**Hook augmentation** (`on-gate-failure.ts`; constraint #4): ONLY on the already-RED
path — read `knowledge/entries/*.md` with node builtins (dir absent → skip), extract
title/tags with a ~15-line inline frontmatter grab (skip entries whose frontmatter has
`status: superseded|deprecated`), score token overlap of failure `name + detail` against
title+tags, and append at most 3 ids:
`Prior lessons that may apply: <id> (knowledge/entries/<id>.md)` plus a nudge that
self-reflection should run `bun run kb:search` first. Zero cost on non-gate Bash calls
(existing early exits untouched); the file reads stay far inside the 10s hook timeout.

**Agent prose (body-only)**: self-reflection Step 1 gains "search first:
`bun run kb:search '<failure keywords>'`", and the output schema gains an
`applied: <ids or none>` line.

**Acceptance**: `bun run check` green including the new retrieval evals; a test asserts
identical ranking across two runs; `bun run kb:search "subagent tools comma"` top-1 is
`subagent-tools-comma-serialization`; the hook is fixture-tested by piping a stdin JSON
event with a fixture evidence file; `grep` proves no `@objectcore/knowledge` import
anywhere under `plugins/`.

**Agent briefing**: Build a pure, deterministic, zero-dep lexical scorer (`searchEntries`)
with field weights, IDF, stopwords, and an id tie-break; expose `kb:search`; add
`knowledge/evals/retrieval.json` run by kb:check (offline — determinism is the point).
The reflection hook must stay dependency-free: give it a tiny inline matcher over
`knowledge/entries/`, never a workspace import. Edit only the agent BODY, never its
description (descriptions are gated trigger surfaces).

### WP4 — Write-time dedup — effort S — depends WP1+WP3 — branch `feat/kb-dedup`

**Goal**: `kb:add` (and `kb:curate --supersede`) refuses a new entry that near-duplicates
an active entry, listing matches and pointing at update/supersede; `--force` overrides.

**Layer decision**: pure policy in the package, enforcement at the CLI edges — NOT inside
`FileKnowledgeStore.append` (the port stays a storage seam; a future `DbKnowledgeStore`
shouldn't inherit threshold policy; `--force` stays a CLI concern; store tests keep
writing fixtures without threshold fights).

**Files**: create `packages/knowledge/src/dedup.ts`, `packages/knowledge/test/dedup.test.ts`;
modify `packages/knowledge/src/index.ts`, `scripts/kb-add.ts`, `scripts/kb-curate.ts`.

```ts
export interface DuplicateMatch { id: string; score: number; title: string; }
export const DUP_THRESHOLD: number; // calibrated; see below
/** Cosine over weighted token multisets (title ×3, tags ×2, body ×1), normalized [0,1].
 *  Caller passes ACTIVE entries; excludeIds for the supersede path. */
export function findNearDuplicates(
  candidate: { title: string; tags?: string[]; body: string },
  entries: KnowledgeEntry[],
  opts?: { threshold?: number; excludeIds?: string[] },
): DuplicateMatch[];
```

**CLI behavior**: before `store.append`, run the check; on any match exit 1 with
`near-duplicate of "<id>" (score 0.71) — update or supersede it (bun run kb:curate), or pass --force`.
The supersede path passes `excludeIds: [oldId]` (a replacement legitimately resembles what
it replaces).

**Calibration (recorded in the PR body)**: run all-pairs similarity over the live active
corpus and report the max (vocabulary-adjacent pairs — the two judge/eval gotchas, the two
KB-architecture entries — must stay below threshold); set `DUP_THRESHOLD` at max-observed
+ ~0.1 margin; confirm a reworded copy of a real entry still trips it. Tests pin behavior
with frozen fixture copies; there is NO live-corpus all-pairs hard gate in `bun run check`
(a `--force`d or hand-authored similar pair must never permanently redden CI).

**Acceptance**: `bun run check` green; re-running `kb:add` with an existing entry's own
title+body is refused naming that entry; `--force` writes; zero matches on the current
corpus at the shipped threshold (asserted once against frozen fixtures).

**Agent briefing**: Add a pure cosine-over-weighted-tokens `findNearDuplicates` next to
the WP3 scorer and enforce it in `kb-add.ts`/`kb-curate.ts` (never in the store).
Calibrate the threshold against the real corpus (report the all-pairs max in the PR) so no
current pair false-positives; `--force` overrides; the supersede path excludes the entry
being replaced.

### WP5 — Usage / ROI — effort S — depends WP1 (prefer after WP2) — branch `feat/kb-usage`

**Goal**: citation events + a stats view ranking prune candidates, linking entries to gate
health via the existing `eval:record --note` convention.

**Storage decision**: append-only **`metrics/kb-usage.jsonl`** (the eval-history
precedent: git-tracked, union-merge-friendly, durable, carries timestamps) — NOT
frontmatter counters (entry churn, merge conflicts, guard growth, no timestamps).

**Files**: create `packages/knowledge/src/usage.ts`, `packages/knowledge/test/usage.test.ts`,
`scripts/kb-cite.ts`, `scripts/kb-stats.ts`; modify `packages/knowledge/src/index.ts`,
`package.json` (`kb:cite`, `kb:stats`), `metrics/README.md`. `metrics/kb-usage.jsonl` is
created on first cite.

```ts
export interface UsageEvent { citedAt: string /* ISO instant */; id: string; source?: string; }
export function parseUsageLog(text: string): UsageEvent[];   // split /\r?\n/, skip blanks, line-numbered errors
export function serializeUsageEvent(e: UsageEvent): string;  // one JSON line, key-ordered
export interface UsageStats { id: string; cited: number; lastCited?: string; }
export function aggregateUsage(events: UsageEvent[]): Map<string, UsageStats>;
```

**CLIs**: `kb:cite <id> [--source "<ref>"]` — the id must resolve via `store.get` (citing
a ghost is a bug); append mirrors `eval-record.ts`'s mechanics including the
missing-trailing-newline guard. `kb:stats [--json] [--fast]` — joins entries × usage ×
WP2 staleness (`--fast` skips the git calls): id, type, status, age-days, cited,
last-cited, freshness; final section "prune candidates" = active entries ranked by
(stale, never-cited, oldest anchor). Warn (never fail) on citations of since-superseded
entries. The eval linkage is prose-level only (constraint #7): after a lesson-driven fix
lands, `bun run eval:record --note "lesson:<id>"`; `kb:stats` may display those refs by
reading `metrics/eval-history.jsonl` as a plain file.

**Acceptance**: `bun run check` green; two cites append exactly two lines (never rewrite);
`kb:stats` renders every active entry with zero-cite defaults; `--fast` spawns no git;
usage parse round-trips CRLF.

**Agent briefing**: Add pure usage-log parse/serialize/aggregate to the knowledge package
and two edge CLIs: `kb:cite` (validated append to git-tracked `metrics/kb-usage.jsonl`,
mirroring eval-history's append mechanics) and `kb:stats` (entries × citations × WP2
staleness, ranking prune candidates). No `packages/eval` changes — the eval linkage is the
`--note "lesson:<id>"` convention plus reading the history JSONL as a file.

### WP6 — Prose / docs / dogfood (merges LAST) — effort S — depends WP1–5 — branch `feat/kb-prose`

**Goal**: teach the human/agent surfaces the new lifecycle. Zero trigger-surface changes.

**Files (body/prose only)**:
- `plugins/knowledge-base/skills/curating-knowledge/SKILL.md` — the lifecycle model,
  search-first step (`kb:search` before writing), supersede/deprecate/verify runbook
  (`kb:curate`), dedup behavior + `--force`, the stats/prune runbook (`kb:stats`,
  `kb:verify`), the `eval:record --note "lesson:<id>"` convention.
- `plugins/knowledge-base/commands/remember.md` — step 1 becomes `kb:search` (replacing
  "check INDEX.md for duplicates").
- `plugins/reflection/agents/self-reflection.md` — cite applied lessons
  (`kb:cite <id> --source "reflection:<failure>"`), write with `"origin":"reflection"`,
  prefer `kb:curate --supersede` when a lesson revises an existing entry. (Whatever WP3
  already added stays; this completes it.)
- BOTH Stop-prompt copies (`plugins/kb-writer/hooks/hooks.json` + `.claude/settings.json`),
  verbatim-identical: mention `kb:search` for dup-checking; "if nothing durable emerged or
  the lesson was already captured, stop silently."
- `CLAUDE.md` + `AGENTS.md` command tables: `kb:curate | kb:search | kb:verify | kb:cite |
  kb:stats | kb:mcp`.
- `plans/README.md` — update the 013 row status.
- Changesets (patch) for `knowledge-base`, `kb-writer`, `reflection` — NO manual
  `plugin.json` edits (`release:version` bumps manifests + keeps `expectEntry.version` in
  lockstep and re-derives the catalog).

**Acceptance**: `bun run check` green; `git diff` shows **zero `description:` line
changes** (grep-assert in the PR); both Stop prompts identical; the committed
`marketplace.json` untouched; three changesets present.

**Agent briefing**: Prose-only pass: update the curating-knowledge skill body, /remember,
the self-reflection agent body, both copies of the Stop-hook prompt, the CLAUDE.md/AGENTS.md
command tables, and add three plugin changesets. Hard rule: do not touch any `description:`
frontmatter — those are activation/delegation-gated trigger surfaces; body edits are
eval-neutral because the judge routes on descriptions only.

### WP7 — KB MCP resource server — effort M — depends WP1+WP3 — branch `feat/kb-mcp`

**Goal**: the access seam — an MCP stdio server over `KnowledgeStore`; dogfooded via a
repo-root `.mcp.json` first; catalog-plugin packaging deferred behind the provenance gate.

**Files**: create `packages/knowledge-mcp/package.json` (auto-workspace via `packages/*`;
the ONLY package depending on `@modelcontextprotocol/sdk`, exact-pinned — the
registry-db/@libsql precedent; `@objectcore/knowledge` stays zero-dep),
`packages/knowledge-mcp/src/server.ts` (store in → `McpServer` out),
`packages/knowledge-mcp/src/main.ts` (stdio entry),
`packages/knowledge-mcp/test/server.test.ts`, repo-root `.mcp.json` (dogfood — safe per
constraint #11), root `package.json` script `kb:mcp`.

```ts
export interface KnowledgeMcpOptions { name?: string; version?: string; usageLogPath?: string; }
export function createKnowledgeServer(store: KnowledgeStore, opts?: KnowledgeMcpOptions): McpServer;
```

- **Resources**: `kb://index` — a FRESH `renderIndex` over active entries (never the
  on-disk INDEX.md, so it can't be stale), `text/markdown`. `kb://entries/{id}` via
  `ResourceTemplate` with a list callback (archived included, marked in the description) —
  body = `serializeEntry(entry)`.
- **Tools** (zod schemas per SDK convention):
  `kb_search { query, k?, type?, tag?, includeArchived? }` → JSON ranked hits (id, score,
  title, type, status) wrapping WP3 `searchEntries`;
  `kb_add { type, title, body, tags?, source?, links?, origin?, force? }` → `{ id }` —
  WP4 dedup refusal (matches named; `force: true` overrides) then `store.append`
  (inheriting collision refusal + the round-trip guard; failures surface as MCP tool
  errors, `isError: true`);
  `kb_cite { id, source? }` — registered ONLY when `opts.usageLogPath` is provided (the
  sink-gated posture of the registry's `events` route). Supersede/deprecate deliberately
  stays CLI/PR-reviewed in v1 — an extension point, not a tool.
- **KB root resolution** (`main.ts`): `--dir <path>` arg > `OBJECTCORE_KB_DIR` env >
  `join(cwd, "knowledge")`. Missing dir self-gates: serve empty lists, never crash.
- **Dogfood wiring** (repo-root `.mcp.json`, new file):
  `{ "mcpServers": { "objectcore-kb": { "command": "bun", "args": ["packages/knowledge-mcp/src/main.ts"] } } }`
- **Deferred plugin packaging (implications named now)**: shipping as a catalog plugin
  needs (a) `bun build --target=bun` bundling (consuming projects can't resolve workspace
  deps — the AGENTS.md "migrate off relative-path sources" class of work); (b) CI-only
  publish: the provenance gate refuses a local MCP-bundle publish, only the attestation
  path in `release.yml` can ship it; (c) no activation/delegation evals (constraint #11)
  but an `evals/output.json` for release lockstep. None of this blocks v1.
- **Tests (fully offline)**: `InMemoryTransport.createLinkedPair()` +
  `@modelcontextprotocol/sdk/client` over a temp-dir `FileKnowledgeStore` (reuse the
  `withStore` pattern from `file-store.test.ts`): resource list/read (index equals a fresh
  render; an entry equals `serializeEntry`); `kb_search` top-1 on a fixture query;
  `kb_add` happy path / dedup refusal / `force` / collision refusal / frontmatter-breaking
  title as tool error; `kb_cite` appends a parseable line and is absent when ungated. If
  SDK types fight `verbatimModuleSyntax`, fix with type-only imports — never tsconfig
  changes.
- **Integration timing**: if built in parallel with WP4/WP5, land resources + `kb_search`
  first and add the `kb_add`-dedup + `kb_cite` integrations as a small follow-up commit
  once those merge.

**Acceptance**: `bun run check` green (new tests included, no network);
`bun run kb:mcp` starts and answers an initialize handshake; in a Claude Code session on
this repo `kb://index` is readable and `kb_search` returns ranked ids;
`@objectcore/knowledge`'s package.json still has zero runtime deps; the SDK appears in
exactly one package.json.

**Agent briefing**: New edge package `packages/knowledge-mcp` (the only SDK-depending
package — the core stays zero-dep) exposing `kb://index` + `kb://entries/{id}` resources
and `kb_search`/`kb_add`/`kb_cite` tools over the existing `FileKnowledgeStore`, stdio
transport, KB root from arg/env/cwd. Dogfood via a new repo-root `.mcp.json` (safe — the
provenance scans only look inside plugin dirs); plugin packaging is explicitly deferred
behind bundling + the CI-only provenance gate. Test everything offline with
`InMemoryTransport.createLinkedPair()`.

---

## Sequencing & merge protocol

```
WP1 (M) merges first
  ├─→ WP2 (S) ∥ WP3 (M)                    (parallel worktrees)
  │            └─→ WP4 (S) ∥ WP5 (S) ∥ WP7-core (M)
  │                                └─ kb_add-dedup + kb_cite follow-up after WP4/WP5
  └─→ WP6 (S) LAST (documents everything)
```

- Overlaps between parallel WPs are trivial and mechanical: `packages/knowledge/src/index.ts`
  export lines and `package.json` script lines. Resolve by taking both sides.
- Every merge re-runs `bun run check`. `kb:index` is needed only by changes that touch
  actual entries — none of WP1–7 changes render output for the current all-active corpus
  (WP1 asserts INDEX byte-identity). If two branches DO add KB entries, the INDEX conflict
  is always resolved by re-running `bun run kb:index`, never by hand-merge.
- `build:marketplace` is needed by NO merge here — no `plugin.json` changes; WP6's
  changesets defer manifest bumps to `release:version`, which re-derives itself.
- Executor protocol per WP: step 0 `git checkout -B <branch> origin/main && bun install`,
  verify base markers (constraint #12), implement, `bun run check` green, commit, PR with
  the WP's acceptance evidence in the body. STOP — a human reviews every merge.

## Verification (global)

Per-WP acceptance above, plus: every merge = `bun run check` green (tsc + catalog
byte-match + kb:check incl. the new lifecycle/retrieval checks + design + tests + eval);
WP1's INDEX byte-identity assertion; WP3's determinism assertion; WP4's calibration report
in the PR; WP7's offline MCP handshake test + a live `kb_search` smoke in a Claude Code
session on this repo. After the epic: `bun run kb:stats` becomes the periodic curation
runbook entry point, and the 200-line/25KB INDEX budget now bounds ACTIVE knowledge only.
