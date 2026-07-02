// meta-generator's engine: expand a compact meta-spec into a full, gate-passing
// PluginSpec for a NEW meta-plugin. This is the self-replicating bit — the factory
// producing more of its own kind. Two archetypes, drawn from the meta-plugins we
// already run:
//   - "generator"  — grill -> plan -> scaffold (like plugin-forge)
//   - "governance" — a /verb command + a reference skill over a rule set
//     (like plugin-validator and marketplace-builder)
// It guarantees the skill is gated (a positive activation case) and tags the
// plugin as a meta-plugin of its archetype. Identity (author) is NOT set here —
// the caller injects it from objectcore.config.json's owner (single source).

import type { ActivationCase } from "@objectcore/eval";
import { FORGE_STUB_MARKER } from "./scaffold";
import type { ComponentSpec, PluginSpec } from "./types";

/** The two archetypes, single-sourced: the type and the runtime guard both read
 *  this list, so they can never drift. */
export const META_ARCHETYPES = ["governance", "generator"] as const;

export type MetaArchetype = (typeof META_ARCHETYPES)[number];

export interface MetaSpecInput {
  archetype: MetaArchetype;
  name: string;
  description: string;
  /** The reference/workflow skill this meta-plugin ships. */
  skill: ComponentSpec;
  /** The command that drives it (e.g. a `/verb`). */
  command: ComponentSpec;
  /** Domain-specific activation cases. A positive for the skill is auto-added if missing. */
  activation?: ActivationCase[];
  keywords?: string[];
  version?: string;
  author?: { name: string; email?: string; url?: string };
}

/** Ensure at least one positive case targets the skill, so coverage passes. The
 *  injected prompt is a near-verbatim echo of the trigger surface — trivially green
 *  under any judge, so it is a PLACEHOLDER, not a real eval. Its note carries the
 *  forge:todo stub marker (the same convention as unfilled bodies) so the
 *  ship-readiness gate can refuse a meta-plugin that never replaced it. */
function ensureCoverage(
  skillName: string,
  skillDescription: string,
  cases: ActivationCase[],
): ActivationCase[] {
  if (cases.some((c) => c.expect === skillName)) return cases;
  return [
    {
      prompt: `Help me with: ${skillDescription}`,
      expect: skillName,
      note: `${FORGE_STUB_MARKER} auto-added so the skill is gated — replace with a real positive prompt`,
    },
    ...cases,
  ];
}

/** Expand a meta-spec into a complete PluginSpec ready for scaffoldPlugin.
 *  A meta-spec arrives as parsed JSON (scripts/forge-meta.ts), so nothing upstream
 *  has type-checked it — reject with the offending field named, matching
 *  scaffold.ts's error style, instead of leaking a raw TypeError. */
export function metaPluginSpec(input: MetaSpecInput): PluginSpec {
  if (!META_ARCHETYPES.includes(input.archetype)) {
    throw new Error(
      `unknown archetype "${input.archetype}" (must be ${META_ARCHETYPES.map((a) => `"${a}"`).join(" | ")})`,
    );
  }
  if (!input.name?.trim()) throw new Error("meta-spec needs a non-empty `name`");
  if (!input.description?.trim()) {
    throw new Error("meta-spec needs a non-empty `description`");
  }
  if (!input.skill?.name?.trim() || !input.skill.description?.trim()) {
    throw new Error("meta-spec needs a `skill` with a name and description");
  }
  if (!input.command?.name?.trim() || !input.command.description?.trim()) {
    throw new Error("meta-spec needs a `command` with a name and description");
  }
  const keywords = Array.from(
    new Set(["objectcore", "meta", input.archetype, ...(input.keywords ?? [])]),
  );
  const spec: PluginSpec = {
    name: input.name,
    description: input.description,
    version: input.version ?? "0.0.1",
    license: "MIT",
    keywords,
    skills: [input.skill],
    commands: [input.command],
    activation: ensureCoverage(input.skill.name, input.skill.description, input.activation ?? []),
  };
  if (input.author) spec.author = input.author;
  return spec;
}
