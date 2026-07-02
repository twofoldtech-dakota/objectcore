#!/usr/bin/env bun
// PostToolUse hook (reflection): the auto-invoke half of the EDDOps loop. When a
// gate command (`bun run check` / `bun run eval`) finishes, this reads the structured
// evidence the eval harness just wrote (dist/eval-evidence.json) and, if the gate
// went RED, injects context nudging delegation to the `self-reflection` subagent —
// so the gate FEEDS the loop instead of only blocking. Self-gating: silent unless
// the command was a gate run AND the evidence is red, so it adds nothing to ordinary
// Bash calls. Standalone (node builtins only) so the plugin ships to any project; a
// project with no ObjectCore evidence file is a silent no-op (like load-kb.ts).

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

interface ToolEvent {
  tool_name?: string;
  tool_input?: { command?: string };
}
interface EvidenceFailure {
  suite: string;
  plugin?: string;
  name: string;
  detail: string;
}
interface Evidence {
  green: boolean;
  generatedAt: string;
  failed: number;
  passed: number;
  failures: EvidenceFailure[];
}

function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

const raw = readStdin();
let event: ToolEvent = {};
try {
  event = JSON.parse(raw) as ToolEvent;
} catch {
  process.exit(0); // not a parseable hook payload — stay silent
}

const command = event.tool_input?.command ?? "";
// Only react to a gate run; ordinary Bash calls must not pay for this hook.
// `(?![\w:-])` keeps non-evidence-writing siblings (`check:catalog`, `eval:trend`,
// `eval:record`) from matching — only `bun run check` / `bun run eval` write
// dist/eval-evidence.json, so only they may trigger reflection.
const isGateRun =
  event.tool_name === "Bash" && /\bbun\s+(run\s+)?(check|eval)(?![\w:-])/.test(command);
if (!isGateRun) process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
let evidence: Evidence;
try {
  evidence = JSON.parse(
    readFileSync(join(projectDir, "dist", "eval-evidence.json"), "utf8"),
  ) as Evidence;
} catch {
  process.exit(0); // no evidence (e.g. not the ObjectCore repo) — nothing to do
}

if (evidence.green) process.exit(0); // gate passed — no reflection needed

// Staleness guard: `bun run check` can go red BEFORE eval runs (tsc, check:catalog),
// leaving the previous run's evidence on disk. Old evidence is not this run's
// verdict — stay silent rather than report a stale red as fresh.
const ageMs = Date.now() - Date.parse(evidence.generatedAt);
if (!Number.isFinite(ageMs) || ageMs > 10 * 60 * 1000) process.exit(0);

const failureLines = evidence.failures
  .slice(0, 12)
  .map((f) => `  ✗ [${f.suite}] ${f.plugin ? f.plugin + " " : ""}${f.name} — ${f.detail}`)
  .join("\n");

let context =
  `The ObjectCore eval gate just went RED (${evidence.failed} failed, ${evidence.passed} passed).\n` +
  `Failures:\n${failureLines}\n\n` +
  `This is the EDDOps feedback point: delegate the \`self-reflection\` subagent to diagnose ` +
  `the root cause and capture any durable lesson into the knowledge base (it reads ` +
  `dist/eval-evidence.json). Do not weaken eval cases to make the gate pass.`;

// --- Prior-lesson surfacing (plan 013 WP3), ONLY on this already-RED path. This is the
// dependency-free INLINE SIBLING of @objectcore/knowledge's `searchEntries`: this hook
// is STANDALONE by design (it ships to consuming projects where workspace packages don't
// resolve), so it must never import the package. A deliberately simpler token-overlap
// matcher over knowledge/entries/*.md is enough to point self-reflection at what to read.
function inlineTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

/** Up to 3 active entry ids whose title+tags overlap the failure text most (id-asc
 *  tie-break — deterministic, like searchEntries). Missing KB dir → []. */
function priorLessons(entriesDir: string, failureText: string): string[] {
  let files: string[];
  try {
    files = readdirSync(entriesDir).filter((f) => f.endsWith(".md"));
  } catch {
    return []; // no KB in this project — skip silently
  }
  const queryTokens = new Set(inlineTokens(failureText));
  if (!queryTokens.size) return [];

  const scored: { id: string; overlap: number }[] = [];
  for (const f of files) {
    let text: string;
    try {
      text = readFileSync(join(entriesDir, f), "utf8").replace(/\r\n/g, "\n");
    } catch {
      continue;
    }
    // ~15-line inline frontmatter grab: title / tags / status only.
    const fmEnd = text.indexOf("\n---", 4);
    const fm = text.startsWith("---\n") && fmEnd !== -1 ? text.slice(4, fmEnd) : "";
    let title = "";
    let tags = "";
    let status = "";
    for (const line of fm.split("\n")) {
      const c = line.indexOf(":");
      if (c === -1) continue;
      const key = line.slice(0, c).trim();
      const val = line.slice(c + 1).trim();
      if (key === "title") title = val;
      else if (key === "tags") tags = val;
      else if (key === "status") status = val;
    }
    if (status === "superseded" || status === "deprecated") continue; // archived — skip

    const entryTokens = new Set(inlineTokens(`${title} ${tags}`));
    let overlap = 0;
    for (const t of queryTokens) if (entryTokens.has(t)) overlap++;
    if (overlap > 0) scored.push({ id: f.slice(0, -3), overlap });
  }
  scored.sort((a, b) => b.overlap - a.overlap || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return scored.slice(0, 3).map((s) => s.id);
}

const failureText = evidence.failures.map((f) => `${f.name} ${f.detail}`).join(" ");
const lessons = priorLessons(join(projectDir, "knowledge", "entries"), failureText);
if (lessons.length) {
  context +=
    `\n\nPrior lessons that may apply: ` +
    lessons.map((id) => `${id} (knowledge/entries/${id}.md)`).join(", ") +
    `. Have \`self-reflection\` run \`bun run kb:search "<failure keywords>"\` first to pull the ` +
    `full lesson before diagnosing.`;
}

// PostToolUse additive-context contract: print JSON with hookSpecificOutput.
console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: context,
    },
  }),
);
