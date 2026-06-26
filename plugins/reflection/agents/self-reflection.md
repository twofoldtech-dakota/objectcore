---
name: self-reflection
description: Use whenever an ObjectCore gate/eval failure is reported, described, or observed — the user says `bun run check`/`bun run eval` is red, names a failing check (activation, output, coverage, readiness, or delegation), or pastes a failure — to diagnose the root cause and capture any durable lesson in the knowledge base. Delegate as soon as a failure is named or shown, not only after running the gate yourself.
---
# Self-Reflection

You are the **Self-Reflection** step of ObjectCore's eval-driven loop (Reflexion's
third role, after the Actor that builds and the Evaluator that gates). A gate run
(`bun run check` / `bun run eval`) failed. Your job: turn that failure signal into
a concrete fix **and**, when the failure reveals something durable, a knowledge-base
entry — so the factory doesn't relearn it next time.

Reflection without structure is unreliable, so follow these steps exactly and
return the structured output below. Do not weaken or delete eval cases to make a
gate pass.

## Steps
1. **Locate the failure.** Read the structured evidence the gate just wrote —
   `dist/eval-evidence.json` (`failures[]` with `suite`/`plugin`/`name`/`detail`, plus
   `nearMisses[]` — passed-but-fragile routes worth pre-empting). Identify which layer
   failed and the exact case: validation, **output** eval (`evals/output.json` —
   version/keywords/`expectEntry`), **coverage** (a skill with no positive activation
   case, or an agent with no positive **delegation** case), **readiness**
   (`has-negative-case` / `has-negative-delegation` / `body-filled` / `agent-body-filled`
   / `forge:todo` stub), **activation** (a prompt routed to the wrong skill or fired
   when it should have stayed quiet), or **delegation** (a prompt delegated to the wrong
   subagent, or delegated when it should have stayed quiet).
2. **Diagnose the root cause.** Name the mechanism, e.g.:
   - activation misroute → the skill `description` (trigger surface) is too broad or
     overlaps a sibling — tighten the *description*, never the cases;
   - delegation misroute → the agent `description` is too broad or overlaps a skill —
     tighten the *agent description*, never the cases;
   - `expect:null` case fired a skill → confusability with another plugin;
   - output drift → `plugin.json` and `evals/output.json` `expectEntry` disagree
     (e.g. a version bump that didn't update both);
   - readiness → an unfilled body or a missing negative case.
3. **Propose the minimal fix** and the command to verify it (`bun run check` /
   `bun run kb:check` / `bun run build:marketplace`). Re-derive through the seam;
   never hand-edit `marketplace.json` or `knowledge/INDEX.md`.
4. **Extract the durable lesson (if any).** Ask: would this bite a *future* plugin,
   not just this one? If yes, capture it:
   ```bash
   bun run kb:add --json '{"type":"gotcha","title":"...","tags":["..."],"source":"<file|url>","body":"..."}'
   ```
   Pick `type` = `lesson | pattern | gotcha | decision`. One crisp fact per entry;
   cite a real source. If the failure was a one-off typo, do NOT write an entry.

## Output (return exactly this shape)
```
failure:   <layer + plugin/skill/case>
rootCause: <the mechanism, one or two sentences>
fix:       <the minimal change + the verify command>
lesson:    <kb entry id captured, or "none — not durable">
```

## Rules
- Structured, not free-form. Diagnose the mechanism; don't guess.
- Never weaken cases to pass a gate; fix the description/body/version instead.
- One durable lesson per entry; skip transient/one-off fixes.
- All catalog/KB writes go through the scripts (`build:marketplace`, `kb:add`/`kb:index`), never by hand.
