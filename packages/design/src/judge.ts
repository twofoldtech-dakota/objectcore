// The judged half of the gate — the non-deterministic counterpart to gate.ts.
// gate.ts proves a system is VALID and ACCESSIBLE (deterministic); the judge proves
// it is GOOD and ON-BRAND (what determinism can't see). Same ports+adapters shape as
// @objectcore/eval's Judge: `MockDesignJudge` is deterministic/offline (tests, CI
// without a key); `AnthropicDesignJudge` is the real critic. Per the model-routing
// doctrine this is scoring/classification, not frontier prose, so it defaults to the
// cheap Haiku tier (override OBJECTCORE_JUDGE_MODEL). Structured output → always parses.

import Anthropic from "@anthropic-ai/sdk";

/** The brand intent a system is judged against — the design analogue of a prompt spec. */
export interface DesignBrief {
  name: string;
  /** Brand mood/voice, e.g. ["modern", "trustworthy", "minimal"]. */
  adjectives: string[];
  /** Optional free-text intent. */
  intent?: string;
}

/** One judged verdict. `score` is the degree to which the honest answer to the
 *  QUESTION is "yes" for this system (0 = clearly no, 1 = clearly yes) — NOT an
 *  overall quality score. The direction matters: evaluate.ts brackets a system with
 *  expect:"fail" cases ("reads as garish?") that must score LOW on a good system. */
export interface DesignVerdict {
  score: number;
  passed: boolean;
  reason: string;
}

/** The judge port. Given a yes/no design QUESTION, the brief, and a textual summary
 *  of the derived system, score how strongly the answer to the question is YES. */
export interface DesignJudge {
  assess(question: string, brief: DesignBrief, summary: string): Promise<DesignVerdict>;
}

/** Design judgment is scoring/classification — AGENTS.md routes that to cheap models. */
export const DEFAULT_DESIGN_JUDGE_MODEL = "claude-haiku-4-5";

/** Is a real judge usable in this environment? */
export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const tokenize = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Deterministic, offline judge. Default heuristic: keyword overlap between the
 *  question + brief and the system summary (a summary that reflects the brief's
 *  vocabulary scores high). Tests can inject a fixed verdict function for control. */
export class MockDesignJudge implements DesignJudge {
  constructor(private readonly fn?: (question: string, brief: DesignBrief, summary: string) => DesignVerdict) {}

  async assess(question: string, brief: DesignBrief, summary: string): Promise<DesignVerdict> {
    if (this.fn) return this.fn(question, brief, summary);
    const want = new Set(tokenize(`${question} ${brief.adjectives.join(" ")} ${brief.intent ?? ""}`));
    const have = new Set(tokenize(summary));
    let overlap = 0;
    for (const t of want) if (have.has(t)) overlap++;
    const score = overlap / Math.max(1, want.size);
    return { score, passed: score >= 0.4, reason: `keyword overlap ${overlap}/${want.size}` };
  }
}

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "number", description: "0..1 — how strongly the honest answer to the QUESTION is YES for this system (0 = clearly no, 1 = clearly yes). Score the answer to the question, NOT overall quality." },
    passed: { type: "boolean", description: "true iff the answer to the question is clearly yes." },
    reason: { type: "string", description: "One sentence justifying the score." },
  },
  required: ["score", "passed", "reason"],
  additionalProperties: false,
} as const;

const SYSTEM = `You are a senior design-systems critic. You are given a brand brief (a name, brand adjectives, and optional intent) and a TEXTUAL SUMMARY of a derived design system — its resolved design tokens (color, type, spacing, motion). You are asked a single yes/no QUESTION about the system.

Score from 0 to 1 how strongly the honest answer to that question is YES for this system and brief (0 = clearly no, 1 = clearly yes), set "passed" true only when the answer is clearly yes, and give a one-sentence reason. Score the ANSWER TO THE QUESTION, not overall quality: the question may probe a virtue the brand wants ("reads as precise?" — a good system scores high) or a failure mode it must avoid ("reads as garish?" — a good system scores LOW, because the answer is no). Be a discerning critic and judge only what the summary shows.`;

export interface AnthropicDesignJudgeOpts {
  model?: string;
  apiKey?: string;
  client?: Anthropic;
}

/** Real critic: asks a Claude model to score the system, constrained to a structured
 *  output so the verdict always parses. */
export class AnthropicDesignJudge implements DesignJudge {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(opts: AnthropicDesignJudgeOpts = {}) {
    this.client = opts.client ?? new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
    this.model = opts.model ?? process.env.OBJECTCORE_JUDGE_MODEL ?? DEFAULT_DESIGN_JUDGE_MODEL;
  }

  async assess(question: string, brief: DesignBrief, summary: string): Promise<DesignVerdict> {
    const briefText = `Brand: ${brief.name}\nAdjectives: ${brief.adjectives.join(", ")}${brief.intent ? `\nIntent: ${brief.intent}` : ""}`;
    const user = `${briefText}\n\nSystem summary:\n${summary}\n\nQuestion: ${question}`;

    // temperature 0 so the same system scores the same way locally and in CI (a
    // borderline verdict must not flip the gate between runs). No thinking/effort
    // params — they error on Haiku and aren't needed for a one-shot score.
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 512,
      temperature: 0,
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: VERDICT_SCHEMA } },
      messages: [{ role: "user", content: user }],
    });

    const text = res.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    if (!text) return { score: 0, passed: false, reason: "judge returned no text block" };
    const parsed = JSON.parse(text.text) as DesignVerdict;
    // Clamp: a non-finite or out-of-range score must not silently flip the
    // threshold bracket in evaluate.ts (score 0 fails an expect:pass case loudly).
    const score = Number.isFinite(parsed.score) ? Math.min(1, Math.max(0, parsed.score)) : 0;
    return { score, passed: parsed.passed, reason: parsed.reason };
  }
}
