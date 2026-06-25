// Output evals: deterministic checks on the derived catalog. These complement
// registry-core's structural validation (which guarantees the catalog *loads*)
// by checking the catalog is *good* — entries describe themselves, and each
// plugin's intent (its optional evals/output.json) matches what was derived.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  MarketplaceJson,
  MarketplaceEntry,
  WorkspacePlugin,
} from "@objectcore/registry-core";
import type { EvalResult, OutputSpec } from "./types";

/** Load `<plugin>/evals/output.json` if present. */
export async function loadOutputSpec(
  plugin: WorkspacePlugin,
): Promise<OutputSpec | null> {
  try {
    const raw = await readFile(join(plugin.dir, "evals", "output.json"), "utf8");
    return JSON.parse(raw) as OutputSpec;
  } catch {
    return null;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Built-in content-quality checks, one entry at a time. */
function checkEntryQuality(entry: MarketplaceEntry): EvalResult[] {
  const out: EvalResult[] = [];
  const base = { suite: "output" as const, plugin: entry.name };
  out.push({
    ...base,
    name: "has-description",
    level: "error",
    passed: Boolean(entry.description && entry.description.trim()),
    detail: entry.description
      ? "description present"
      : "catalog entry has no description — it will be invisible in /plugin browse",
  });
  out.push({
    ...base,
    name: "has-version",
    level: "warning",
    passed: Boolean(entry.version),
    detail: entry.version ? `version ${entry.version}` : "no version (Changesets release will need one)",
  });
  out.push({
    ...base,
    name: "has-keywords",
    level: "warning",
    passed: Array.isArray(entry.keywords) && entry.keywords.length > 0,
    detail:
      entry.keywords && entry.keywords.length
        ? `${entry.keywords.length} keyword(s)`
        : "no keywords (hurts discoverability)",
  });
  return out;
}

/** Per-plugin expectEntry assertions: derived entry must match the spec subset. */
function checkExpectedEntry(
  plugin: WorkspacePlugin,
  entry: MarketplaceEntry | undefined,
  spec: OutputSpec,
): EvalResult[] {
  if (!spec.expectEntry) return [];
  const base = { suite: "output" as const, plugin: plugin.manifest.name, level: "error" as const };
  if (!entry) {
    return [{ ...base, name: "expect-entry", passed: false, detail: "no derived catalog entry to compare against" }];
  }
  const results: EvalResult[] = [];
  for (const [key, want] of Object.entries(spec.expectEntry)) {
    const got = (entry as unknown as Record<string, unknown>)[key];
    results.push({
      ...base,
      name: `expect-entry:${key}`,
      passed: deepEqual(got, want),
      detail: deepEqual(got, want)
        ? `${key} matches`
        : `${key}: expected ${JSON.stringify(want)}, derived ${JSON.stringify(got)}`,
    });
  }
  return results;
}

/** Run every output eval over the derived catalog. */
export async function runOutputEvals(
  plugins: WorkspacePlugin[],
  catalog: MarketplaceJson,
): Promise<EvalResult[]> {
  const byName = new Map(catalog.plugins.map((e) => [e.name, e]));
  const results: EvalResult[] = [];
  for (const entry of catalog.plugins) {
    results.push(...checkEntryQuality(entry));
  }
  for (const plugin of plugins) {
    const spec = await loadOutputSpec(plugin);
    if (spec) {
      results.push(...checkExpectedEntry(plugin, byName.get(plugin.manifest.name), spec));
    }
  }
  return results;
}
