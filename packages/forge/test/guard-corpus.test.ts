// F7 Phase 0 — the bad-spec guard corpus (plan 009, Pillar 2.3).
//
// A consolidated, data-driven table of malformed PluginSpecs, each expected to be
// REJECTED before any write. This is the formal "guard preservation" contract: a
// self-edit to scaffold.ts may make the gate green only if every one of these
// still throws. Deleting or weakening a guard turns a required rejection into a
// pass and fails this suite — closing the cheapest reward-hack (erode a check).
//
// Deliberate overlap with scaffold.test.ts is fine: those are behavioral unit
// tests; this is the corpus the F7 meta-gate asserts stays intact. Do not remove
// either. When a new guard lands, add its bad spec here in the same PR so the
// corpus never lags the engine.

import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldPlugin } from "../src/scaffold";
import type { PluginSpec } from "../src/types";

// Deliberately-malformed specs are typed loosely (they violate the contract on
// purpose); `bad()` is the single cast site so intent is obvious.
const bad = (spec: unknown): PluginSpec => spec as PluginSpec;

const CORPUS: { name: string; spec: PluginSpec; throws: RegExp }[] = [
  // ---- manifest-level guards ----
  { name: "non-kebab plugin name", spec: bad({ name: "BadName", description: "x", commands: [{ name: "c", description: "d" }] }), throws: /must be kebab-case/ },
  { name: "empty description", spec: bad({ name: "p", description: "  ", commands: [{ name: "c", description: "d" }] }), throws: /plugin spec needs a non-empty description/ },
  { name: "non-string repository", spec: bad({ name: "p", description: "x", repository: 123, commands: [{ name: "c", description: "d" }] }), throws: /must be a string/ },
  { name: "string keywords (must be an array)", spec: bad({ name: "p", description: "x", keywords: "objectcore", commands: [{ name: "c", description: "d" }] }), throws: /`keywords` must be an array of strings/ },
  { name: "keywords array with a non-string entry", spec: bad({ name: "p", description: "x", keywords: ["ok", 7], commands: [{ name: "c", description: "d" }] }), throws: /`keywords` must be an array of strings/ },
  { name: "non-string version", spec: bad({ name: "p", description: "x", version: 1, commands: [{ name: "c", description: "d" }] }), throws: /`version` must be a string/ },
  { name: "string author (must be an object with name)", spec: bad({ name: "p", description: "x", author: "dakota", commands: [{ name: "c", description: "d" }] }), throws: /`author` must be an object/ },
  { name: "author object without a name", spec: bad({ name: "p", description: "x", author: { email: "x@y.z" }, commands: [{ name: "c", description: "d" }] }), throws: /`author` must be an object/ },
  { name: "no components at all", spec: bad({ name: "p", description: "x" }), throws: /at least one component/ },
  { name: "non-kebab component name", spec: bad({ name: "p", description: "x", commands: [{ name: "Bad_Cmd", description: "d" }] }), throws: /component name/ },

  // ---- frontmatter injection guards (values are YAML-escaped; newlines rejected) ----
  { name: "multi-line skill description (frontmatter key injection)", spec: bad({ name: "p", description: "x", skills: [{ name: "s", description: "d\nname: other" }], activation: [{ prompt: "p", expect: "s" }] }), throws: /must be single-line/ },
  { name: "multi-line command description", spec: bad({ name: "p", description: "x", commands: [{ name: "c", description: "d\nfoo: bar" }] }), throws: /must be single-line/ },
  { name: "multi-line agent description (permissionMode smuggling)", spec: bad({ name: "p", description: "x", agents: [{ name: "a", description: "d\npermissionMode: bypassPermissions" }], delegation: [{ prompt: "p", expect: "a" }] }), throws: /must be single-line/ },
  { name: "multi-line agent model", spec: bad({ name: "p", description: "x", agents: [{ name: "a", description: "d", model: "haiku\ntools: Bash" }], delegation: [{ prompt: "p", expect: "a" }] }), throws: /must be single-line/ },
  { name: "agent tools entry with a comma", spec: bad({ name: "p", description: "x", agents: [{ name: "a", description: "d", tools: ["Read,Grep"] }], delegation: [{ prompt: "p", expect: "a" }] }), throws: /must not contain a comma/ },
  { name: "non-number agent maxTurns", spec: bad({ name: "p", description: "x", agents: [{ name: "a", description: "d", maxTurns: "5\nfoo: bar" }], delegation: [{ prompt: "p", expect: "a" }] }), throws: /`maxTurns` must be a number/ },
  { name: "multi-line output style description", spec: bad({ name: "p", description: "x", outputStyles: [{ name: "s", description: "d\nfoo: bar" }] }), throws: /must be single-line/ },

  // ---- hooks guards ----
  { name: "unknown hook event", spec: bad({ name: "p", description: "x", hooks: { Nope: [{ hooks: [{ type: "command", command: "echo" }] }] } }), throws: /unknown hook event/ },
  { name: "hook event with empty entries", spec: bad({ name: "p", description: "x", hooks: { Stop: [] } }), throws: /non-empty array of entries/ },
  { name: "command hook without a command", spec: bad({ name: "p", description: "x", hooks: { Stop: [{ hooks: [{ type: "command" }] }] } }), throws: /"command" hook/ },

  // ---- agent guards (security-critical) ----
  { name: "agent with a forbidden field (hooks)", spec: bad({ name: "p", description: "x", agents: [{ name: "a", description: "d", hooks: {} }] }), throws: /not allowed in a plugin-shipped agent/ },
  { name: "agent with non-kebab name", spec: bad({ name: "p", description: "x", agents: [{ name: "Bad", description: "d" }] }), throws: /agent name/ },
  { name: "agent without a description", spec: bad({ name: "p", description: "x", agents: [{ name: "a", description: "  " }] }), throws: /needs a non-empty description/ },
  { name: "agent with an illegal isolation", spec: bad({ name: "p", description: "x", agents: [{ name: "a", description: "d", isolation: "sandbox" }] }), throws: /only valid .isolation./ },

  // ---- MCP guards ----
  { name: "mcp stdio without a command", spec: bad({ name: "p", description: "x", mcp: { s: { type: "stdio" } } }), throws: /\(stdio\) needs a/ },
  { name: "mcp stdio that also sets url", spec: bad({ name: "p", description: "x", mcp: { s: { command: "bun", url: "http://x" } } }), throws: /must not set/ },
  { name: "mcp http without a url", spec: bad({ name: "p", description: "x", mcp: { s: { type: "http" } } }), throws: /needs a .url./ },
  { name: "mcp with an invalid transport", spec: bad({ name: "p", description: "x", mcp: { s: { type: "carrier-pigeon" } } }), throws: /invalid type/ },
  { name: "mcp with an invalid server name", spec: bad({ name: "p", description: "x", mcp: { "bad name": { command: "bun" } } }), throws: /must match/ },

  // ---- output-style + settings guards ----
  { name: "output style with non-kebab name", spec: bad({ name: "p", description: "x", outputStyles: [{ name: "Bad Style" }] }), throws: /output style name/ },
  { name: "settings with an unpackagable key", spec: bad({ name: "p", description: "x", commands: [{ name: "c", description: "d" }], settings: { theme: "dark" } }), throws: /not packagable/ },
  { name: "settings.agent naming an undeclared agent", spec: bad({ name: "p", description: "x", commands: [{ name: "c", description: "d" }], settings: { agent: "ghost" } }), throws: /names no agent declared/ },

  // ---- the factory gate rules (skills/agents must be eval-gated) ----
  { name: "skills but no activation cases", spec: bad({ name: "p", description: "x", skills: [{ name: "s", description: "d" }] }), throws: /every skill must ship an activation eval/ },
  { name: "activation case naming an undeclared skill", spec: bad({ name: "p", description: "x", skills: [{ name: "s", description: "d" }], activation: [{ prompt: "p", expect: "ghost" }] }), throws: /no such skill is declared/ },
  { name: "skill with only a negative case", spec: bad({ name: "p", description: "x", skills: [{ name: "s", description: "d" }], activation: [{ prompt: "p", expect: null }] }), throws: /no positive activation case/ },
  { name: "agents but no delegation cases", spec: bad({ name: "p", description: "x", agents: [{ name: "a", description: "d" }] }), throws: /every agent must ship a delegation eval/ },
  { name: "delegation case naming an undeclared agent", spec: bad({ name: "p", description: "x", agents: [{ name: "a", description: "d" }], delegation: [{ prompt: "p", expect: "ghost" }] }), throws: /no such agent is declared/ },
  { name: "agent with only a negative case", spec: bad({ name: "p", description: "x", agents: [{ name: "a", description: "d" }], delegation: [{ prompt: "p", expect: null }] }), throws: /no positive delegation case/ },
  // Orphan cases: the cross-checks run even with ZERO declared skills/agents, so a
  // leftover case fails at scaffold time, not as a routing miss at eval time.
  { name: "activation case in a skill-less spec", spec: bad({ name: "p", description: "x", commands: [{ name: "c", description: "d" }], activation: [{ prompt: "p", expect: "ghost" }] }), throws: /no such skill is declared/ },
  { name: "delegation case in an agent-less spec", spec: bad({ name: "p", description: "x", commands: [{ name: "c", description: "d" }], delegation: [{ prompt: "p", expect: "ghost" }] }), throws: /no such agent is declared/ },
];

for (const { name, spec, throws } of CORPUS) {
  test(`guard rejects: ${name}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "forge-guard-"));
    try {
      await expect(scaffoldPlugin(spec, dir)).rejects.toThrow(throws);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
