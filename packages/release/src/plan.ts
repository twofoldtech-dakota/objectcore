// Release planning: (current plugin versions, changesets) -> what to bump and to
// what. Pure and deterministic (sorted in, sorted out) — the same property the
// catalog seam has, so a plan is reproducible and testable without touching disk.

import type { Bump } from "./semver";
import { bumpVersion, maxBump } from "./semver";
import type { Changeset } from "./changeset";

/** A plugin's current name + version, as read from its plugin.json. */
export interface PluginVersion {
  name: string;
  version: string;
}

/** One plugin's planned release. */
export interface Release {
  name: string;
  oldVersion: string;
  newVersion: string;
  bump: Bump;
  /** Changelog summaries from every changeset that touched this plugin. */
  summaries: string[];
}

export interface ReleasePlan {
  releases: Release[];
  /** Changeset bumps that name a plugin not in the workspace (typo / stale). */
  unknown: { changeset: string; plugin: string }[];
}

/** Aggregate changesets into a per-plugin plan. Overlapping bumps take the max. */
export function planRelease(plugins: PluginVersion[], changesets: Changeset[]): ReleasePlan {
  const versionByName = new Map(plugins.map((p) => [p.name, p.version]));
  const agg = new Map<string, { bump: Bump; summaries: string[] }>();
  const unknown: { changeset: string; plugin: string }[] = [];

  // Sort by id so summary order and aggregation are deterministic.
  for (const cs of [...changesets].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const [name, bump] of Object.entries(cs.bumps)) {
      if (!versionByName.has(name)) {
        unknown.push({ changeset: cs.id, plugin: name });
        continue;
      }
      const cur = agg.get(name);
      if (cur) {
        cur.bump = maxBump(cur.bump, bump);
        if (cs.summary) cur.summaries.push(cs.summary);
      } else {
        agg.set(name, { bump, summaries: cs.summary ? [cs.summary] : [] });
      }
    }
  }

  const releases: Release[] = [...agg.entries()]
    .map(([name, { bump, summaries }]) => {
      const oldVersion = versionByName.get(name) as string;
      return { name, oldVersion, newVersion: bumpVersion(oldVersion, bump), bump, summaries };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { releases, unknown };
}
