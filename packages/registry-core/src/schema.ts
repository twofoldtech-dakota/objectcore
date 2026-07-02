// Strict manifest schema validation — the Stage 2 floor that `validateManifests`
// hinted at. It is hand-rolled (not ajv) on purpose: registry-core is the pure
// seam and stays dependency-free, the same way it hand-rolls its kebab regex and
// JSON-based deepEqual. The win over the targeted checks in validate.ts is
// *completeness*: it rejects UNKNOWN fields (a `keyword`/`repositry` typo silently
// drops a plugin from discoverability) and wrong types on every spec field, not
// just the three hard-load ones. Mirrors PluginManifest in types.ts exactly.

import type { PluginManifest, WorkspacePlugin } from "./types";
import type { ValidationIssue } from "./validate";

/** Every field PluginManifest permits, with how to type-check it. */
type FieldCheck = "string" | "string[]" | "semver" | "author" | "dependencies";

/** Strict MAJOR.MINOR.PATCH — `version` mints the `{plugin}--v{semver}` release tag
 *  (tags.ts), so a malformed version is a hard error at the gate, not at release
 *  time. Matches the bump-time floor in @objectcore/release's parseVersion. */
const SEMVER = /^\d+\.\d+\.\d+$/;

const MANIFEST_FIELDS: Record<keyof PluginManifest, FieldCheck> = {
  name: "string",
  displayName: "string",
  version: "semver",
  description: "string",
  author: "author",
  homepage: "string",
  repository: "string",
  license: "string",
  keywords: "string[]",
  category: "string",
  skills: "string",
  commands: "string",
  agents: "string",
  hooks: "string",
  mcpServers: "string",
  dependencies: "dependencies",
};

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

function checkAuthor(v: unknown): string | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return "`author` must be an object";
  const a = v as Record<string, unknown>;
  if (typeof a.name !== "string" || !a.name.trim()) return "`author.name` must be a non-empty string";
  for (const [k, val] of Object.entries(a)) {
    if (k !== "name" && k !== "email" && k !== "url") return `unknown \`author\` field \`${k}\``;
    if (val !== undefined && typeof val !== "string") return `\`author.${k}\` must be a string`;
  }
  return null;
}

function checkDependencies(v: unknown): string | null {
  if (!Array.isArray(v)) return "`dependencies` must be an array";
  for (const dep of v) {
    if (typeof dep === "string") continue;
    if (typeof dep === "object" && dep !== null && typeof (dep as { name?: unknown }).name === "string") continue;
    return "each `dependencies` entry must be a string or `{ name, version?, marketplace? }`";
  }
  return null;
}

/** Strict shape check of every manifest: unknown fields + per-field types. */
export function validateSchema(plugins: WorkspacePlugin[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const allowed = MANIFEST_FIELDS as Record<string, FieldCheck>;

  for (const p of plugins) {
    const m = p.manifest as unknown as Record<string, unknown>;
    const id = (m.name as string) || p.relDir;

    for (const [key, value] of Object.entries(m)) {
      const check = allowed[key];
      if (!check) {
        issues.push({ level: "error", plugin: id, message: `unknown manifest field \`${key}\`` });
        continue;
      }
      if (value === undefined) continue;
      let problem: string | null = null;
      switch (check) {
        case "string":
          if (typeof value !== "string") problem = `\`${key}\` must be a string`;
          break;
        case "string[]":
          if (!isStringArray(value)) problem = `\`${key}\` must be an array of strings`;
          break;
        case "semver":
          if (typeof value !== "string" || !SEMVER.test(value))
            problem = `\`${key}\` must be MAJOR.MINOR.PATCH semver (e.g. 0.1.0) — it mints the release tag`;
          break;
        case "author":
          problem = checkAuthor(value);
          break;
        case "dependencies":
          problem = checkDependencies(value);
          break;
      }
      if (problem) issues.push({ level: "error", plugin: id, message: problem });
    }
  }
  return issues;
}
