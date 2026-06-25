// The deterministic "tests" floor (code checks these). The non-deterministic eval
// layer (does the skill activate? did the generator take the right steps?) lands in
// Stage 1. Stage 2 added strict manifest schema validation (`validateSchema`, hand-
// rolled to keep the pure core dependency-free) — it runs inside `validateAll`.

import { access } from "node:fs/promises";
import { join } from "node:path";
import type { MarketplaceJson, WorkspacePlugin } from "./types";
import { validateSchema } from "./schema";

export interface ValidationIssue {
  level: "error" | "warning";
  plugin?: string;
  message: string;
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Reserved marketplace names, blocked for third parties (verified spec). */
const RESERVED_MARKETPLACE_NAMES = new Set([
  "claude-code-marketplace",
  "claude-code-plugins",
  "claude-plugins-official",
  "claude-plugins-community",
  "claude-community",
  "anthropic-marketplace",
  "anthropic-plugins",
  "agent-skills",
  "anthropic-agent-skills",
  "knowledge-work-plugins",
  "life-sciences",
  "claude-for-legal",
  "claude-for-financial-services",
  "financial-services-plugins",
]);

/** Targeted manifest checks for the three hard-load rules. `validateSchema`
 *  (in schema.ts) covers the full strict shape — unknown fields and every type. */
export function validateManifests(plugins: WorkspacePlugin[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const p of plugins) {
    const m = p.manifest;
    const id = m.name || p.relDir;
    if (!m.name) {
      issues.push({ level: "error", plugin: id, message: "manifest missing required `name`" });
    } else if (!KEBAB.test(m.name)) {
      issues.push({ level: "error", plugin: id, message: "`name` must be kebab-case" });
    }
    if (m.repository !== undefined && typeof m.repository !== "string") {
      issues.push({ level: "error", plugin: id, message: "`repository` must be a string, not an object" });
    }
    if (m.keywords !== undefined && !Array.isArray(m.keywords)) {
      issues.push({ level: "error", plugin: id, message: "`keywords` must be an array" });
    }
  }
  return issues;
}

/** The marketplace-sync invariant: every plugin dir <-> exactly one catalog entry. */
export function validateSync(
  plugins: WorkspacePlugin[],
  catalog: MarketplaceJson,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const dirNames = new Set(plugins.map((p) => p.manifest.name).filter(Boolean));
  const seen = new Set<string>();

  for (const e of catalog.plugins) {
    if (seen.has(e.name)) {
      issues.push({ level: "error", plugin: e.name, message: "duplicate catalog entry" });
    }
    seen.add(e.name);
    if (!dirNames.has(e.name)) {
      issues.push({ level: "error", plugin: e.name, message: "catalog entry has no plugin dir (stale entry — re-run build:marketplace)" });
    }
  }
  for (const n of dirNames) {
    if (!seen.has(n)) {
      issues.push({ level: "error", plugin: n, message: "plugin dir has no catalog entry (re-run build:marketplace)" });
    }
  }
  return issues;
}

/** Marketplace name must be kebab-case and not reserved. */
export function validateMarketplaceName(name: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!KEBAB.test(name)) {
    issues.push({ level: "error", message: `marketplace name \`${name}\` must be kebab-case` });
  }
  if (RESERVED_MARKETPLACE_NAMES.has(name)) {
    issues.push({ level: "error", message: `marketplace name \`${name}\` is reserved by Anthropic` });
  }
  return issues;
}

/** Directory-placement lint: components must live at the plugin root, not inside .claude-plugin/. */
export async function validatePlacement(plugins: WorkspacePlugin[]): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const forbidden = ["commands", "agents", "skills", "hooks"];
  for (const p of plugins) {
    for (const f of forbidden) {
      try {
        await access(join(p.dir, ".claude-plugin", f));
        issues.push({
          level: "error",
          plugin: p.manifest.name || p.relDir,
          message: `\`${f}/\` must be at the plugin root, not inside .claude-plugin/`,
        });
      } catch {
        // good — not present
      }
    }
  }
  return issues;
}

/** Run every check. */
export async function validateAll(
  plugins: WorkspacePlugin[],
  catalog: MarketplaceJson,
): Promise<ValidationIssue[]> {
  return [
    ...validateMarketplaceName(catalog.name),
    ...validateManifests(plugins),
    ...validateSchema(plugins),
    ...validateSync(plugins, catalog),
    ...(await validatePlacement(plugins)),
  ];
}
