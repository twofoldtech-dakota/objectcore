---
id: structured-outputs-reject-numeric-range-keywords-minimum-maximum-on-number-types
type: gotcha
title: Structured outputs reject numeric range keywords (minimum/maximum) on number types
tags: [judge, structured-outputs, anthropic-api, eval]
source: packages/eval/src/judge.ts
created: 2026-07-02
---

The Anthropic structured-outputs API returns 400 ("For 'number' type, properties maximum, minimum are not supported") when a number property in `output_config.format.schema` carries `minimum`/`maximum` — the request never reaches the model. Both judges (eval ROUTE_SCHEMA, design VERDICT_SCHEMA) hit this class of constraint.

State the range in the property `description` instead, and clamp the parsed value in code (`Math.min(1, Math.max(0, n))`, with a `Number.isFinite` guard). The clamp is load-bearing, not belt-and-braces: an out-of-range or NaN score would silently flip the threshold bracket in the eval runner.

Caught on the first CI run that armed the judged layers (PR #23). The failure surfaced exactly as designed — a `judge-error` red result with evidence written, not a crash — because a judge exception is a gate failure, never a skipped case.
