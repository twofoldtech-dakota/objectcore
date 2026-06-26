#!/usr/bin/env bun
// PostToolUse hook (reflection): the auto-invoke half of the EDDOps loop. When a
// gate command (`bun run check` / `bun run eval`) finishes, this reads the structured
// evidence the eval harness just wrote (dist/eval-evidence.json) and, if the gate
// went RED, injects context nudging delegation to the `self-reflection` subagent —
// so the gate FEEDS the loop instead of only blocking. Self-gating: silent unless
// the command was a gate run AND the evidence is red, so it adds nothing to ordinary
// Bash calls. Standalone (node builtins only) so the plugin ships to any project; a
// project with no ObjectCore evidence file is a silent no-op (like load-kb.ts).

import { readFileSync } from "node:fs";
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
const isGateRun =
  event.tool_name === "Bash" && /\bbun\s+(run\s+)?(check|eval)\b/.test(command);
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

const failureLines = evidence.failures
  .slice(0, 12)
  .map((f) => `  ✗ [${f.suite}] ${f.plugin ? f.plugin + " " : ""}${f.name} — ${f.detail}`)
  .join("\n");

const context =
  `The ObjectCore eval gate just went RED (${evidence.failed} failed, ${evidence.passed} passed).\n` +
  `Failures:\n${failureLines}\n\n` +
  `This is the EDDOps feedback point: delegate the \`self-reflection\` subagent to diagnose ` +
  `the root cause and capture any durable lesson into the knowledge base (it reads ` +
  `dist/eval-evidence.json). Do not weaken eval cases to make the gate pass.`;

// PostToolUse additive-context contract: print JSON with hookSpecificOutput.
console.log(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: context,
    },
  }),
);
