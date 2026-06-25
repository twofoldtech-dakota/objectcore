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
import type { ComponentSpec, PluginSpec } from "./types";

export type MetaArchetype = "governance" | "generator";

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

/** Ensure at least one positive case targets the skill, so coverage passes. */
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
      note: "auto-added so the skill is gated — replace with a real positive prompt",
    },
    ...cases,
  ];
}

/** Expand a meta-spec into a complete PluginSpec ready for scaffoldPlugin. */
export function metaPluginSpec(input: MetaSpecInput): PluginSpec {
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
