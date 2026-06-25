# Plan 007: Harden the forge prose — trigger-surface recipe, activation-case budget, category vocabulary, real-body requirement

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. Touch
> only the in-scope files. **Change skill BODIES only — never the frontmatter
> `description:` lines** (those are trigger surfaces; changing them can break
> `plugin-forge`'s own activation eval). If a STOP condition occurs, stop and
> report. When done, update the status row in `plans/README.md` (unless a reviewer
> told you they maintain the index).
>
> **Drift check (run first)**: `git diff --stat 9beeee8..HEAD -- plugins/plugin-forge/skills`
> If any forge skill changed since this plan was written, re-read it before editing.

## Status

- **Priority**: P3
- **Effort**: S (prose only)
- **Risk**: LOW
- **Depends on**: 006 (this documents, for authors, exactly what plans 005+006
  now enforce — do it after 006 so the prose matches reality)
- **Category**: docs / dx (the human/frontier-model guidance half of forge)
- **Planned at**: commit `9beeee8`, 2026-06-25

## Why this matters

The 003 forge spike showed the forge *engine* is solid but its *prose* — the
grill→plan guidance a frontier model follows to produce a `PluginSpec` — leaves
the load-bearing decisions to guesswork: it says "spend real effort" on the
trigger surface but gives no method; it asks for "at least one confusability
negative" with no budget and no enforcement; it lists an "optional category" with
no vocabulary; and its example marks the skill `body` optional, so the path of
least resistance ships a stub. Plans 005 and 006 now *enforce* a positive+negative
gate, reject stub bodies, and cross-check activation cases. This plan updates the
prose so an author is guided to produce specs that pass those gates the first
time, replacing "spend real effort" with a concrete recipe, a case budget, a
category list, and an explicit real-body requirement.

## Current state

Three files under `plugins/plugin-forge/skills/`. **Frontmatter `description:`
lines must stay byte-identical** (trigger surfaces). Edit only the markdown bodies.

- `planning/SKILL.md` — body decisions list (steps 1-5) + a `PluginSpec` JSON
  example. Today step 2 says *"draft `name` + `description` so it fires on the
  right task and stays quiet on near-misses. Most skill failures are description
  failures — spend real effort here."* Step 4 lists *"optional category"* with no
  set. Step 5 says *"positive prompts that must fire it and negatives that must
  not — include at least one confusability negative"* (no budget). The example
  shows `{ "name": "do-x", "description": "Use when …", "body": "# optional
  markdown body" }`.
- `writing-great-skills/SKILL.md` — the reference: three layers (metadata / body /
  reference), "most skill failures are description failures", "a skill that never
  fires is worse than one that fails to parse".
- `specifying/SKILL.md` — the grilling gate. Its Verification bullet says *"For
  every skill, name the prompt that MUST fire it and a near-miss that must NOT."*

**Convention:** these are reference/runbook skills; keep the terse, imperative
ObjectCore voice (short directives, no fluff). Use the ubiquitous language from
`CONTEXT.md` (trigger surface, activation case, catalog entry).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Catalog gate (bodies don't affect entries) | `bun run check:catalog` | exit 0, "in sync" |
| Output+coverage evals | `bun run eval` | output+coverage green (activation skipped w/o key) |
| All tests | `bun test` | all pass |

## Scope

**In scope** (bodies only — NOT frontmatter):
- `plugins/plugin-forge/skills/planning/SKILL.md`
- `plugins/plugin-forge/skills/writing-great-skills/SKILL.md`
- `plugins/plugin-forge/skills/specifying/SKILL.md`

**Out of scope** (do NOT touch):
- Any frontmatter `description:` line in those files (trigger surfaces).
- `plugins/plugin-forge/evals/**` — no activation-case changes; the descriptions
  are unchanged, so the existing cases still hold.
- The engine (`packages/forge/**`) and evals (`packages/eval/**`) — those are
  plans 005/006; this plan only *documents* what they enforce.
- Any other plugin.

## Git workflow
- Branch: `advisor/007-forge-prose-hardening`
- One commit, plain imperative message. Do NOT push.

## Steps

### Step 1: `planning/SKILL.md` — recipe, budget, categories, real body

Edit the body (keep the frontmatter):

- **Step 2 (trigger surface):** after "Most skill failures are description
  failures", replace "spend real effort here" with the concrete recipe. Target
  content:
  > Build the description from three parts: the **artifact** it acts on (e.g. "the
  > staged diff"), the **form** of the output (e.g. "conventional-commits style"),
  > and the **enumerated entry-triggers** (e.g. "about to commit / asks for a
  > message / wants wording improved"). Then check it against the *sibling*
  > surfaces already in the catalog so it doesn't overlap one of them.

- **Step 4 (catalog shape):** give `category` a small vocabulary. Target content:
  > `category` (optional) must come from the catalog's vocabulary —
  > `workflow | governance | generator | meta | example` — or be omitted; do not
  > invent a one-off string.

- **Step 5 (activation cases):** add the budget and the enforcement note. Target
  content:
  > Write a **budget** of cases, not a token one: **≥2 positives** covering
  > *distinct* intents (e.g. drafting vs. revising), **≥1 plain negative**
  > (clearly unrelated), and **≥1 confusability negative** that shares vocabulary
  > with a *sibling* catalog surface but has the wrong intent. The gate now
  > enforces both halves: a skill needs a positive case (or the scaffold refuses
  > it) **and** the plugin needs a negative case (or coverage fails).

- **The `PluginSpec` example:** change the skill entry's `body` from the optional
  placeholder to a real one, and add a one-line note under the JSON. Target:
  ```json
  { "name": "do-x", "description": "Use when …", "body": "# Do X\n\nReal instructions: the steps, the output format, any reference to load." }
  ```
  > A skill `body` is **required for real (non-meta) plugins** — omit it and the
  > scaffolder emits a visible `<!-- forge:todo -->` stub that the eval gate
  > rejects (`body-filled`). Write the actual instructions here.

**Verify**: frontmatter line 3 (`description:`) is unchanged
(`git diff plugins/plugin-forge/skills/planning/SKILL.md` shows no change to the
`---` block).

### Step 2: `writing-great-skills/SKILL.md` — recipe + real-body principle

In the body, under the Metadata bullet, add the same artifact+form+entry-triggers
recipe (one sentence), and add a principle that for a real (non-meta) skill the
**body is mandatory** — the metadata decides *whether* it fires, the body decides
*what it does*, and an unfilled body is a stub the gate rejects. Keep it terse.

**Verify**: frontmatter unchanged.

### Step 3: `specifying/SKILL.md` — align the verification bullet with the budget

Update the Verification bullet body so it matches the new budget: instead of "name
the prompt that MUST fire it and a near-miss that must NOT", require naming **≥2
firing prompts (distinct intents), a clearly-unrelated negative, and a
confusability near-miss aimed at a sibling surface.** Keep the rest of the grilling
gate as-is.

**Verify**: frontmatter unchanged.

### Step 4: Confirm the gate stays green and commit

```
bun run check:catalog && bun run eval && bun test
```
- `check:catalog` → exit 0 (skill bodies are not part of catalog entries, so the
  derived `marketplace.json` is unchanged and stays byte-in-sync).
- `bun run eval` → output+coverage green. The new bodies contain no `forge:todo`,
  and `plugin-forge` already has negative cases, so the plan-006 gates pass.
- `bun test` → all pass.

Commit the three files on `advisor/007-forge-prose-hardening`.

## Test plan
This plan is prose; its "tests" are the gates:
- `check:catalog` proves the catalog entries are unchanged (bodies excluded).
- `bun run eval` proves the prose changes didn't introduce a stub marker or remove
  a required case.
No new unit tests.

## Done criteria
ALL must hold:
- [ ] The three skill **frontmatter `description:` lines are byte-unchanged**
      (`git diff 9beeee8..HEAD -- plugins/plugin-forge/skills | grep '^[+-].*description:'`
      returns nothing)
- [ ] `bun run check:catalog` exits 0 ("in sync")
- [ ] `bun run eval` shows output+coverage green on the real catalog
- [ ] `bun test` exits 0
- [ ] `git diff --name-only 9beeee8..HEAD` lists only the three forge skill files
- [ ] The prose now states: the artifact+form+entry-triggers recipe, the case
      budget (≥2 positives / ≥1 negative / ≥1 confusability), the category
      vocabulary, and the real-body requirement

## STOP conditions
Stop and report if:
- Editing would require changing a frontmatter `description:` to make a point —
  don't; the body is where this guidance goes.
- `bun run eval` goes red after your edits (e.g. a body accidentally contains
  `forge:todo`, or a description drifted) — report it.
- A verification fails twice after a reasonable fix.

## Maintenance notes
- If plan 006's category vocabulary or case budget changes, update this prose in
  lockstep — the prose is the human-facing contract over the deterministic gates.
- Reviewer should confirm the three `description:` lines are identical to `9beeee8`
  (a changed trigger surface is a silent behavior change to `plugin-forge`).
- Deferred: actually *finishing* `commit-craft` (held on `advisor/003`) through
  this hardened prose + a real body + the activation gate is a separate step.
