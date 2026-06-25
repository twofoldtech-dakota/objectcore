# Plan 003 — Forge-first-plugin spike: gap report

Spike to run the deterministic `/forge` pipeline (grill → plan → scaffold → gate) on one
concrete end-user plugin (`commit-craft`) — the first non-infrastructure plugin in the
catalog — and report what to harden in the forge prose and engine. The plugin is the
vehicle; this report is the deliverable.

## Outcome

Stopped at the offline gate, activation pending (no key). The deterministic half ran
clean on the first try: `bun run forge:scaffold plans/notes/commit-craft.spec.json`
scaffolded `plugins/commit-craft/` (plugin.json, the skill SKILL.md, evals/{activation,output}.json),
re-derived the catalog to 7 plugins, and the offline gate (output + coverage evals) was
green at 39/0. All deterministic gates pass: `bunx tsc` exit 0, `bun test` 47/0, `bun run
check:catalog` exit 0 (7 plugins valid, catalog byte-in-sync). The activation gate
(`bun run eval`) reported `[skipped] activation evals — no ANTHROPIC_API_KEY` — explicitly
skipped, never silently passed. Per AGENTS.md hard rule 5 the plugin is therefore
**offline-green with activation pending**, not fully "shipped" — that requires a re-run of
`bun run eval` with `ANTHROPIC_API_KEY` set, which routes the four hand-authored cases
(2 positive, 1 plain negative, 1 confusability negative) against the whole catalog's
trigger surfaces. No friction needed a workaround; the spec from the plan scaffolded as-is.

## Forge prose gaps

Having hand-authored the PluginSpec, the guidance in `plugins/plugin-forge/skills/{specifying,planning,writing-great-skills}/SKILL.md`
is missing or vague about the following — all decisions I had to make with no rule to lean on:

1. **No activation-case budget.** `specifying` (line 15) asks for "the prompt that MUST
   fire it and a near-miss that must NOT" — singular, implying one of each. `planning`
   step 5 says "positive prompts ... and negatives ... include at least one confusability
   negative" — plural but with no minimum. The only *enforced* floor is the coverage eval's
   "≥1 positive per skill." Nothing tells the author to write **two positives covering
   distinct intents** — for commit-craft, *drafting from a staged diff* vs *improving
   existing wording* are different triggers and I wrote a case for each, but that was
   judgment, not guidance. A spec with one positive and zero negatives passes the offline
   gate.

2. **The confusability negative is prose-only, never enforced.** `planning` step 5 names it
   ("at least one confusability negative (shares words, wrong intent)") and `writing-great-skills`
   stakes the whole discipline on "quiet enough not to fire on the wrong one" — yet the
   scaffold engine and the coverage eval require **no negative case at all**, let alone a
   confusing one. The half of the trigger-surface contract that matters most (staying quiet
   on near-misses) is unchecked by the deterministic gate. Worse, writing a *good*
   confusability negative requires knowing the **whole catalog's** surfaces: my negative
   ("Review my plugin against the marketplace rules before I add it to the catalog") is a
   near-miss against `plugin-validator`, not against commit-craft's own vocabulary — and
   nothing in the prose tells the author to survey sibling surfaces before choosing it.

3. **No method for a distinctive trigger surface.** All three skills repeat "most skill
   failures are description failures" (`specifying` line 7, `planning` step 2,
   `writing-great-skills` line 8) but none gives a *technique*. The description that worked
   here follows a concrete pattern — **artifact** ("the staged diff") + **form**
   ("conventional-commits-style") + **enumerated entry-triggers** ("about to commit / asks
   for a commit message / wants their commit wording improved"). That recipe is exactly what
   makes a surface fire precisely and is reusable, but the prose never names it; an author is
   told to "spend real effort" with no description of what the effort produces.

4. **No category vocabulary.** `planning` step 4 lists "optional category" with no allowed
   set. I picked `"workflow"` by guessing — and commit-craft is now the **only** plugin in
   the catalog with a category at all (the other six have none). So there is neither a
   canonical list to match against nor any consistency check; categories are free-form
   strings that nothing dedupes or canonicalizes. Either categories should have a small
   enumerated vocabulary in the prose (e.g. workflow | governance | generator | …) or the
   field should be dropped from the planning checklist until it earns a consumer.

5. **The example PluginSpec omits `body`, so real skills get a stub.** `planning`'s example
   (lines 19–34) shows `{ "name": "do-x", "description": "Use when …", "body": "# optional
   markdown body" }` with body marked *optional*, and `writing-great-skills` describes the
   metadata/body/reference layers but never says that for a **real** (non-infra) skill the
   body is mandatory. The path of least resistance — omit `body`, as the plan's spec did —
   produces a SKILL.md whose body just re-states the description verbatim and appends the
   boilerplate "Keep the description precise…" meta-paragraph (see
   `plugins/commit-craft/skills/writing-commit-messages/SKILL.md`). For commit-craft the real
   instructions (read the staged diff, the conventional-commits format, scope, the
   breaking-change footer) are absent. This is the single biggest gap for shipping a *real*
   end-user plugin via forge: the deterministic scaffold cannot synthesize a body, and the
   prose does not force the planner to supply one.

## Engine / CLI friction

- **"GREEN" is printed while the hard rule is unmet.** `forge:scaffold`'s offline gate ends
  "39 passed, 0 failed" and `bun run eval` prints "✓ eval gate is GREEN" — both with
  activation `[skipped]`. The skip line is explicit (good, no silent pass), but the top-line
  GREEN overstates state: a plugin can sit in `marketplace.json` fully "green" offline while
  never having passed its activation eval — precisely the failure mode hard rule 5 warns
  against. Nothing marks the catalog entry as activation-pending. (`scripts/_finalize.ts`
  `syncAndGate`, `scripts/eval.ts`.)

- **No clean tune-and-re-gate loop; the spec goes stale on first tune.** The plan itself says
  that if activation fails you tighten the skill `description` directly in the generated
  SKILL.md. The moment you do, the kept-as-record `commit-craft.spec.json` and the on-disk
  plugin diverge, and re-running `forge:scaffold --force` from the (now stale) spec would
  overwrite the tuned description. So the real `grill → plan → scaffold → gate → **tune**`
  loop has no path that keeps spec and plugin in sync — the spec is authoritative only until
  the first activation miss.

- **Activation↔skill cross-references aren't validated pre-write.** `scaffoldPlugin`
  (`packages/forge/src/scaffold.ts`) guards kebab-case, empty description, missing component,
  string `repository`, and "skills but no activation" *before* writing — but it does **not**
  check that each `activation[].expect` names a real skill, nor that every skill has a
  *positive* case. Those are caught later by the coverage eval inside `syncAndGate`, **after**
  files are on disk. A typo (`writing-commit-message` vs `writing-commit-messages`) would
  write the whole plugin dir, then fail the gate, leaving a half-scaffolded directory the
  next run must `--force` over. The pre-write guard is the right place for this cross-check.

- **Minor — defaults are silent.** `forge:scaffold` applies `version` (when absent),
  `license: MIT`, and `author = config.owner` with no echo, and there is no `--dry-run` to
  preview the PluginSpec→files mapping before writing. For a one-shot deterministic emit this
  is fine; noted only because the author can't see which fields were defaulted vs supplied.

## Recommendations (candidate plans)

1. **Gate the negative half of the trigger surface.** Add a coverage check that every
   skill-bearing plugin ships ≥1 `expect:null` case (and ideally flags when no negative
   shares vocabulary with any positive — the confusability requirement). This turns the
   confusability-negative that `planning` only *describes* into something the offline gate
   *enforces*, closing the unchecked "stays quiet on near-misses" half. Scope: `@objectcore/eval`
   coverage evals + the `planning` prose. Small.

2. **Add a "trigger-surface recipe" + activation-case budget to the forge prose.** Name the
   concrete pattern (artifact + form + enumerated entry-triggers; contrast against sibling
   catalog surfaces) and a default budget (≥2 positives across distinct intents, ≥1 plain
   negative, ≥1 confusability negative) in `planning` and `writing-great-skills`. Replaces
   "spend real effort" with a method and a count. Scope: prose only, two SKILL.md files.

3. **Stop real skills shipping a stub body.** Either require `body` in the PluginSpec for
   end-user (non-meta) plugins, or make the generated default body a visibly unfinished
   `<!-- TODO: skill instructions -->` so a never-filled body cannot masquerade as a finished
   skill — optionally an output/coverage eval that fails when a skill body is byte-identical
   to the generated stub. Scope: `packages/forge/src/scaffold.ts` + a small eval; the
   `planning` example should also drop "optional" from `body` for real plugins.

4. **Move activation↔skill cross-validation into the pre-write guard.** In `scaffoldPlugin`,
   before any file is written, assert every `activation[].expect` (non-null) names a declared
   skill and every skill has ≥1 positive case, throwing with the offending name. Fails a
   typo'd spec cleanly instead of leaving a half-written plugin dir for the next `--force`.
   Scope: `packages/forge/src/scaffold.ts` + a unit test.
