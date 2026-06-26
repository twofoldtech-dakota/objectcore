// The deterministic scaffolder: PluginSpec -> files on disk. It guards the hard
// rules at generation time (kebab-case names, components at the plugin ROOT, a
// string `repository`, an array `keywords`) and enforces the factory rule that a
// skill must ship an activation eval. It never overwrites an existing plugin dir
// without `force`. After scaffolding, the catalog is re-derived and the gate run
// by scripts/forge-scaffold.ts — this module only emits.

import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AgentSpec,
  ComponentSpec,
  HooksSpec,
  McpSpec,
  OutputStyleSpec,
  PluginSettingsSpec,
  PluginSpec,
  ScaffoldResult,
} from "./types";

// Canonical rule lives in registry-core/validate.ts; mirrored here for a fast
// pre-write guard so we never emit a plugin the catalog would later reject.
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// The five hook action types (code.claude.com/docs/en/hooks). Used to reject a
// malformed hooks spec before writing.
const HOOK_ACTION_TYPES = new Set(["command", "http", "mcp_tool", "prompt", "agent"]);

// Documented lifecycle events — mirrored from the hooks docs as a typo guard
// ("SesionStart" should fail loudly, not emit a dead hook). Update if docs add events.
const HOOK_EVENTS = new Set([
  "SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse",
  "PostToolUseFailure", "Stop", "StopFailure", "SubagentStop", "PreCompact",
  "Notification", "FileChanged", "PermissionRequest", "InstructionsLoaded",
]);

/** Pre-write guard for a hooks spec: known events, non-empty entries, and a valid
 *  action type (+ the required field for command/prompt). Throws before any write. */
function validateHooks(hooks: HooksSpec): void {
  const events = Object.keys(hooks);
  if (!events.length) throw new Error("`hooks` is present but has no events");
  for (const event of events) {
    if (!HOOK_EVENTS.has(event)) {
      throw new Error(`unknown hook event "${event}" (typo? see code.claude.com/docs/en/hooks)`);
    }
    const entries = hooks[event];
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error(`hook event "${event}" must have a non-empty array of entries`);
    }
    for (const entry of entries) {
      if (!Array.isArray(entry.hooks) || entry.hooks.length === 0) {
        throw new Error(`a "${event}" hook entry must have a non-empty \`hooks\` array`);
      }
      for (const action of entry.hooks) {
        if (!HOOK_ACTION_TYPES.has(action.type)) {
          throw new Error(
            `invalid hook action type "${action.type}" in "${event}" (must be command|http|mcp_tool|prompt|agent)`,
          );
        }
        if (action.type === "command" && !action.command) {
          throw new Error(`a "command" hook in "${event}" needs a \`command\``);
        }
        if (action.type === "prompt" && !action.prompt) {
          throw new Error(`a "prompt" hook in "${event}" needs a \`prompt\``);
        }
      }
    }
  }
}

// Plugin-shipped agents may NOT carry these (they could hijack permissions or
// lifecycle events). Rejected before any write — the core subagent security rule.
const FORBIDDEN_AGENT_FIELDS = ["hooks", "mcpServers", "permissionMode"];

/** Pre-write guard for subagents: kebab name, a description, the one legal
 *  isolation value, and NONE of the forbidden fields. Throws before any write. */
function validateAgents(agents: AgentSpec[]): void {
  for (const a of agents) {
    if (!KEBAB.test(a.name)) throw new Error(`agent name "${a.name}" must be kebab-case`);
    if (!a.description?.trim()) throw new Error(`agent "${a.name}" needs a non-empty description`);
    if (a.isolation !== undefined && a.isolation !== "worktree") {
      throw new Error(`agent "${a.name}": the only valid \`isolation\` is "worktree"`);
    }
    for (const f of FORBIDDEN_AGENT_FIELDS) {
      if (f in (a as unknown as Record<string, unknown>)) {
        throw new Error(
          `agent "${a.name}": \`${f}\` is not allowed in a plugin-shipped agent (security)`,
        );
      }
    }
  }
}

// MCP server names: a conservative charset so the key is a safe identifier across
// the host's config surface (letters, digits, _ and -).
const MCP_NAME = /^[a-zA-Z0-9_-]+$/;
const MCP_TRANSPORTS = new Set(["stdio", "http", "sse"]);

/** Pre-write guard for an MCP spec: a valid name per server, a known transport, and
 *  the field required by that transport (stdio ⇒ command; http/sse ⇒ url) — with the
 *  wrong-transport fields rejected so a typo'd config fails loudly, not at runtime.
 *  Throws before any write. */
function validateMcp(mcp: McpSpec): void {
  const names = Object.keys(mcp);
  if (!names.length) throw new Error("`mcp` is present but defines no servers");
  for (const name of names) {
    if (!MCP_NAME.test(name)) {
      throw new Error(`MCP server name "${name}" must match ${MCP_NAME} (letters, digits, _ , -)`);
    }
    const s = mcp[name]!;
    const type = s.type ?? "stdio";
    if (!MCP_TRANSPORTS.has(type)) {
      throw new Error(`MCP server "${name}": invalid type "${type}" (must be stdio|http|sse)`);
    }
    if (type === "stdio") {
      if (!s.command?.trim()) throw new Error(`MCP server "${name}" (stdio) needs a \`command\``);
      if (s.url) throw new Error(`MCP server "${name}" (stdio) must not set \`url\``);
    } else {
      if (!s.url?.trim()) throw new Error(`MCP server "${name}" (${type}) needs a \`url\``);
      if (s.command || s.args) {
        throw new Error(`MCP server "${name}" (${type}) must not set \`command\`/\`args\``);
      }
    }
  }
}

/** Pre-write guard for output styles: kebab-case name (the filename stem). Throws
 *  before any write. */
function validateOutputStyles(styles: OutputStyleSpec[]): void {
  for (const s of styles) {
    if (!KEBAB.test(s.name)) {
      throw new Error(`output style name "${s.name}" must be kebab-case`);
    }
  }
}

// The only settings keys honored when a plugin contributes them (Claude Code docs).
const SETTINGS_KEYS = new Set(["agent", "subagentStatusLine"]);

/** Pre-write guard for plugin settings: only the packagable keys, and `agent` must
 *  name a declared agent (it runs that agent as the main thread). Throws before any
 *  write. */
function validateSettings(settings: PluginSettingsSpec, agentNames: Set<string>): void {
  for (const key of Object.keys(settings)) {
    if (!SETTINGS_KEYS.has(key)) {
      throw new Error(
        `plugin settings key "${key}" is not packagable — only agent|subagentStatusLine are honored`,
      );
    }
  }
  if (settings.agent !== undefined) {
    if (typeof settings.agent !== "string" || !settings.agent.trim()) {
      throw new Error("`settings.agent` must be a non-empty string");
    }
    if (!agentNames.has(settings.agent)) {
      throw new Error(
        `settings.agent "${settings.agent}" names no agent declared in this plugin`,
      );
    }
  }
}

const json = (v: unknown): string => JSON.stringify(v, null, 2) + "\n";

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function emit(written: string[], path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  written.push(path);
}

function titleCase(name: string): string {
  return name.replace(/(^|-)([a-z0-9])/g, (_, sep, ch) => (sep ? " " : "") + ch.toUpperCase()).trim();
}

/** Sentinel marking an unfilled scaffolded skill body. Plan 006's eval fails any
 *  shipped skill whose body still contains it. Kept as a plain string (no cross-package
 *  import) — eval scans for this literal. */
export const FORGE_STUB_MARKER = "<!-- forge:todo -->";

function defaultSkillBody(s: ComponentSpec): string {
  return `# ${titleCase(s.name)}

${FORGE_STUB_MARKER} Replace this stub with the real skill instructions — what to do,
the steps, the output format, and any reference to load. The frontmatter \`description\`
is the trigger surface (it decides firing); this body is what runs once the skill fires.
`;
}

// forge:improvable — defaultCommandBody only echoes the description; a richer default (a "what it does" line + an example invocation stub) would lift every scaffolded command's baseline quality. Behavior-preserving refinement candidate (plan 009 Phase 2).
function defaultCommandBody(c: ComponentSpec): string {
  return `# /${c.name}

${c.description}
`;
}

function skillDoc(s: ComponentSpec): string {
  return `---\nname: ${s.name}\ndescription: ${s.description}\n---\n${s.body ?? defaultSkillBody(s)}`;
}

function commandDoc(c: ComponentSpec): string {
  return `---\ndescription: ${c.description}\n---\n${c.body ?? defaultCommandBody(c)}`;
}

function defaultAgentBody(a: AgentSpec): string {
  return `# ${titleCase(a.name)}

${FORGE_STUB_MARKER} Replace this stub with the agent's system prompt — its role, when
it is delegated to, the steps it takes, and the exact shape of what it returns.
`;
}

function defaultOutputStyleBody(s: OutputStyleSpec): string {
  return `# ${titleCase(s.name)}

${FORGE_STUB_MARKER} Replace this stub with the output style's system-prompt instructions —
how Claude should shape its responses when this style is active (tone, structure,
what to emphasize or omit).
`;
}

/** Serialize an output style to `output-styles/<name>.md`. Frontmatter uses the
 *  hyphenated Claude Code keys; unset booleans are omitted. */
function outputStyleDoc(s: OutputStyleSpec): string {
  const fm: string[] = [`name: ${s.name}`];
  if (s.description) fm.push(`description: ${s.description}`);
  if (s.keepCodingInstructions) fm.push(`keep-coding-instructions: true`);
  if (s.forceForPlugin) fm.push(`force-for-plugin: true`);
  return `---\n${fm.join("\n")}\n---\n${s.body ?? defaultOutputStyleBody(s)}`;
}

/** Serialize a subagent to `agents/<name>.md`. Tool/skill lists are comma-separated
 *  strings (the YAML-array form has a known spawn bug). */
function agentDoc(a: AgentSpec): string {
  const fm: string[] = [`name: ${a.name}`, `description: ${a.description}`];
  if (a.model) fm.push(`model: ${a.model}`);
  if (a.effort) fm.push(`effort: ${a.effort}`);
  if (a.maxTurns !== undefined) fm.push(`maxTurns: ${a.maxTurns}`);
  if (a.tools?.length) fm.push(`tools: ${a.tools.join(", ")}`);
  if (a.disallowedTools?.length) fm.push(`disallowedTools: ${a.disallowedTools.join(", ")}`);
  if (a.skills?.length) fm.push(`skills: ${a.skills.join(", ")}`);
  if (a.memory) fm.push(`memory: ${a.memory}`);
  if (a.background !== undefined) fm.push(`background: ${a.background}`);
  if (a.isolation) fm.push(`isolation: ${a.isolation}`);
  return `---\n${fm.join("\n")}\n---\n${a.body ?? defaultAgentBody(a)}`;
}

/** Emit a complete, gated plugin from a spec. Throws before writing anything if
 *  the spec violates a hard rule or the target exists (without `force`). */
export async function scaffoldPlugin(
  spec: PluginSpec,
  pluginsDir: string,
  opts: { force?: boolean } = {},
): Promise<ScaffoldResult> {
  const skills = spec.skills ?? [];
  const commands = spec.commands ?? [];
  const agents = spec.agents ?? [];
  const outputStyles = spec.outputStyles ?? [];

  if (!KEBAB.test(spec.name)) throw new Error(`plugin name "${spec.name}" must be kebab-case`);
  if (!spec.description?.trim()) throw new Error("plugin spec needs a non-empty description");
  if (spec.repository !== undefined && typeof spec.repository !== "string") {
    throw new Error("`repository` must be a string");
  }
  const hasHooks = !!(spec.hooks && Object.keys(spec.hooks).length);
  const hasMcp = !!(spec.mcp && Object.keys(spec.mcp).length);
  // Settings is an adjunct (its `agent` references another component), not a
  // standalone component — so it doesn't satisfy the "has a component" floor.
  if (
    skills.length + commands.length + agents.length + outputStyles.length === 0 &&
    !hasHooks &&
    !hasMcp
  ) {
    throw new Error(
      "a plugin needs at least one component (skill, command, agent, hooks, mcp, or output style)",
    );
  }
  for (const c of [...skills, ...commands]) {
    if (!KEBAB.test(c.name)) throw new Error(`component name "${c.name}" must be kebab-case`);
  }
  if (spec.hooks) validateHooks(spec.hooks);
  if (agents.length) validateAgents(agents);
  if (spec.mcp) validateMcp(spec.mcp);
  if (outputStyles.length) validateOutputStyles(outputStyles);
  if (spec.settings) {
    validateSettings(spec.settings, new Set(agents.map((a) => a.name)));
  }
  // The factory rule: a skill that never fires is worse than one that fails to
  // parse, so a plugin with skills must ship activation cases to gate them.
  if (skills.length > 0 && !(spec.activation && spec.activation.length)) {
    throw new Error(
      "plugin has skills but no activation cases — every skill must ship an activation eval",
    );
  }
  // Cross-check activation cases against the declared skills BEFORE writing, so a
  // typo'd spec fails cleanly instead of leaving a half-scaffolded dir for --force.
  if (skills.length > 0) {
    const skillNames = new Set(skills.map((s) => s.name));
    for (const c of spec.activation ?? []) {
      if (c.expect !== null && !skillNames.has(c.expect)) {
        throw new Error(
          `activation case expects "${c.expect}" but no such skill is declared`,
        );
      }
    }
    for (const s of skills) {
      const hasPositive = (spec.activation ?? []).some((c) => c.expect === s.name);
      if (!hasPositive) {
        throw new Error(
          `skill "${s.name}" has no positive activation case (expect: "${s.name}")`,
        );
      }
    }
  }
  // The agent analogue of the skill rule: an agent the orchestrator never delegates
  // to is worse than one that fails to parse, so a plugin with agents must ship
  // delegation cases that gate each one (F4 closed this gap).
  if (agents.length > 0) {
    if (!(spec.delegation && spec.delegation.length)) {
      throw new Error(
        "plugin has agents but no delegation cases — every agent must ship a delegation eval",
      );
    }
    const agentNames = new Set(agents.map((a) => a.name));
    for (const c of spec.delegation) {
      if (c.expect !== null && !agentNames.has(c.expect)) {
        throw new Error(
          `delegation case expects "${c.expect}" but no such agent is declared`,
        );
      }
    }
    for (const a of agents) {
      const hasPositive = spec.delegation.some((c) => c.expect === a.name);
      if (!hasPositive) {
        throw new Error(
          `agent "${a.name}" has no positive delegation case (expect: "${a.name}")`,
        );
      }
    }
  }

  const dir = join(pluginsDir, spec.name);
  if (!opts.force && (await exists(dir))) {
    throw new Error(`${dir} already exists — pass { force: true } to overwrite`);
  }

  const written: string[] = [];

  const manifest: Record<string, unknown> = {
    name: spec.name,
    version: spec.version ?? "0.0.1",
    description: spec.description,
  };
  if (spec.author) manifest.author = spec.author;
  manifest.license = spec.license ?? "MIT";
  if (spec.keywords?.length) manifest.keywords = spec.keywords;
  if (spec.category) manifest.category = spec.category;
  if (spec.repository) manifest.repository = spec.repository;
  await emit(written, join(dir, ".claude-plugin", "plugin.json"), json(manifest));

  for (const s of skills) {
    await emit(written, join(dir, "skills", s.name, "SKILL.md"), skillDoc(s));
  }
  for (const c of commands) {
    await emit(written, join(dir, "commands", `${c.name}.md`), commandDoc(c));
  }
  for (const a of agents) {
    await emit(written, join(dir, "agents", `${a.name}.md`), agentDoc(a));
  }

  // Hooks: the spec carries just the events map; the plugin file requires the
  // `{ "hooks": {...} }` wrapper (a plugin-specific rule the engine owns).
  if (spec.hooks) {
    await emit(written, join(dir, "hooks", "hooks.json"), json({ hooks: spec.hooks }));
  }

  // MCP: emit `.mcp.json` at the plugin ROOT (the file the provenance scan looks
  // for). The spec carries the server map; the engine owns the `{ "mcpServers": {...} }`
  // wrapper. Server objects live here, NOT in plugin.json (whose `mcpServers` is only
  // a path-override string) — so the manifest schema stays clean.
  if (spec.mcp) {
    await emit(written, join(dir, ".mcp.json"), json({ mcpServers: spec.mcp }));
  }

  for (const s of outputStyles) {
    await emit(written, join(dir, "output-styles", `${s.name}.md`), outputStyleDoc(s));
  }

  // Settings: emit only the packagable keys at the plugin root (empty -> skip).
  if (spec.settings && Object.keys(spec.settings).length) {
    const out: Record<string, unknown> = {};
    if (spec.settings.agent !== undefined) out.agent = spec.settings.agent;
    if (spec.settings.subagentStatusLine !== undefined) {
      out.subagentStatusLine = spec.settings.subagentStatusLine;
    }
    await emit(written, join(dir, "settings.json"), json(out));
  }

  if (spec.activation?.length) {
    await emit(written, join(dir, "evals", "activation.json"), json({ cases: spec.activation }));
  }
  if (spec.delegation?.length) {
    await emit(written, join(dir, "evals", "delegation.json"), json({ cases: spec.delegation }));
  }
  const expectEntry = spec.expectEntry ?? { version: spec.version ?? "0.0.1" };
  await emit(written, join(dir, "evals", "output.json"), json({ expectEntry }));

  return { dir, written };
}
