---
name: specifying
description: The grilling gate for plugin-forge — turn a vague plugin request into a pinned spec before any planning or scaffolding. Use at the start of /forge, when a generation request is underspecified, or when the scope of a plugin keeps shifting.
---
# Specifying (the grilling gate)

A generator is only as good as its spec. Resolve every branch *before* planning — the cost of a vague spec is a plugin that parses but never fires.

Grill until you can answer, concretely:

- **Outcome** — what does success look like, in one sentence the requester would sign off on?
- **Scope & non-goals** — what is explicitly in, and what is explicitly *out*?
- **Constraints** — runtime, dependencies, distribution, naming, and any prior decisions that must hold.
- **Component shape** — is this a workflow (skills), an action (commands), or automation (hooks/agents)? Prefer workflow-enforcement over capability-extension.
- **Verification** — how is each outcome checked? For every skill, name the prompt that MUST fire it and a near-miss that must NOT.

Pin the answers as a short `spec.md`. If any answer is "it depends", "probably", or "we'll see", keep grilling — do not hand off to `planning` until the spec is decided.
