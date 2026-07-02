// The Judge port and its two adapters — the same ports+adapters shape the
// registry uses for sources/sinks. MockJudge is deterministic and runs offline
// (tests, CI without a key); AnthropicJudge is the real router. Swapping them
// changes nothing about the activation layer that consumes a Judge.

import Anthropic from "@anthropic-ai/sdk";
import type { Judge, RouteDecision, TriggerSurface } from "./types";

/** Default skill-router model. The activation eval is a CLASSIFICATION task, which
 *  AGENTS.md routes to cheap models ("Cheap models run validation, lint, and
 *  catalog-sync"). Override with OBJECTCORE_JUDGE_MODEL. */
export const DEFAULT_JUDGE_MODEL = "claude-haiku-4-5";

/** Is a real judge usable in this environment? */
export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const tokenize = (s: string): string[] =>
  s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Deterministic, offline judge. Default heuristic is keyword overlap between the
 *  prompt and each surface's name+description; the best-overlapping surface above
 *  a threshold wins. Tests can inject a fixed routing function for full control. */
export class MockJudge implements Judge {
  constructor(
    private readonly fn?: (
      prompt: string,
      candidates: TriggerSurface[],
    ) => RouteDecision,
  ) {}

  async route(prompt: string, candidates: TriggerSurface[]): Promise<RouteDecision> {
    if (this.fn) return this.fn(prompt, candidates);
    const promptTokens = new Set(tokenize(prompt));
    let best: { surface: TriggerSurface; score: number } | null = null;
    for (const s of candidates) {
      const surfaceTokens = new Set(tokenize(`${s.name} ${s.description}`));
      let overlap = 0;
      for (const t of promptTokens) if (surfaceTokens.has(t)) overlap++;
      const score = overlap / Math.max(1, promptTokens.size);
      if (!best || score > best.score) best = { surface: s, score };
    }
    if (!best || best.score < 0.15) {
      return { skill: null, confidence: 0.5, reason: "no surface overlapped the prompt" };
    }
    return {
      skill: best.surface.name,
      confidence: Math.min(1, best.score),
      reason: `keyword overlap with "${best.surface.name}"`,
    };
  }
}

const ROUTE_SCHEMA = {
  type: "object",
  properties: {
    // Empty string means "no skill fires" — avoids null-type schema edge cases.
    skill: { type: "string", description: "Exact skill name that fires, or \"\" if none." },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "0..1 confidence in the decision.",
    },
    reason: { type: "string", description: "One sentence justifying the choice." },
  },
  required: ["skill", "confidence", "reason"],
  additionalProperties: false,
} as const;

const SYSTEM = `You are the skill router inside an agent harness. Each turn you are given a set of skills, each with a name and a description (its "trigger surface"), and a single user prompt.

Decide which ONE skill — if any — should activate for that prompt. A skill activates only when its description genuinely matches what the prompt is asking for. Most prompts match no skill; when in doubt, fire nothing. Return the skill's exact name, or "" when no skill should fire. This mirrors how skills are actually selected: on the description alone, not the body.`;

export interface AnthropicJudgeOpts {
  model?: string;
  apiKey?: string;
  client?: Anthropic;
}

/** Real router: asks a Claude model to pick the firing skill, constrained to a
 *  structured output so the verdict always parses. */
export class AnthropicJudge implements Judge {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(opts: AnthropicJudgeOpts = {}) {
    this.client =
      opts.client ?? new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
    this.model = opts.model ?? process.env.OBJECTCORE_JUDGE_MODEL ?? DEFAULT_JUDGE_MODEL;
  }

  async route(prompt: string, candidates: TriggerSurface[]): Promise<RouteDecision> {
    const surfaceList = candidates
      .map((s) => `- ${s.name}: ${s.description}`)
      .join("\n");
    const user = `Available skills:\n${surfaceList || "(none)"}\n\nUser prompt:\n${prompt}`;

    // temperature 0: routing is a CLASSIFICATION, so it must be deterministic and
    // reproducible — the same prompt has to route the same way locally and in CI.
    // At the model default a borderline case flips between runs and flakes the gate.
    // No thinking/effort params: those error on Haiku 4.5 and aren't needed for a
    // one-shot classification. Structured output guarantees a parseable verdict.
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 512,
      temperature: 0,
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: ROUTE_SCHEMA } },
      messages: [{ role: "user", content: user }],
    });

    const text = res.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    if (!text) {
      // Fail CLOSED: a verdict-less response must not score as "no skill fires" —
      // that would green every expect:null case on a malfunctioning judge. Throw
      // (like the JSON.parse below on garbage) and let the caller turn it red.
      throw new Error(`judge returned no text block (stop_reason=${res.stop_reason})`);
    }
    const parsed = JSON.parse(text.text) as {
      skill: string;
      confidence: number;
      reason: string;
    };
    const skill = parsed.skill === "" ? null : parsed.skill;
    // A hallucinated name outside the candidate pool is a legitimate routing
    // FAILURE, not a crash: keep the name so the case fails against `expect`,
    // but annotate the reason so the failure detail is diagnosable.
    const known = skill === null || candidates.some((c) => c.name === skill);
    return {
      skill,
      // Clamp to the RouteDecision contract (0..1): score.ts's near-miss and
      // confidence-margin math consume this value raw.
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      reason: known
        ? parsed.reason
        : `${parsed.reason} [unknown skill "${skill}" — not a candidate]`,
    };
  }
}
