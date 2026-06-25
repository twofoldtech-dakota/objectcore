# Plan 006: Gate the negative half of the trigger surface + fail unfilled (stub) skill bodies

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. Touch
> only the in-scope files. If a STOP condition occurs, stop and report. When done,
> update the status row for this plan in `plans/README.md` (unless a reviewer told
> you they maintain the index).
>
> **Drift check (run first)**: `git diff --stat 9beeee8..HEAD -- packages/eval/src/coverage.ts packages/eval/src/trigger-surface.ts packages/eval/test/eval.test.ts`
> If any in-scope file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW (all existing skill-bearing plugins already satisfy both new gates — verified below)
- **Depends on**: 005 (this scans for the `forge:todo` stub marker that plan 005 introduced; 005 is merged to main at `9beeee8`)
- **Category**: tests / gate-hardening
- **Planned at**: commit `9beeee8`, 2026-06-25

## Why this matters

The 003 forge spike found that the deterministic gate only checks the *positive*
half of a skill's trigger surface: `coverage.ts` requires every skill to have a
positive activation case, but **nothing requires a negative case** — yet "stays
quiet on near-misses" is the half that the forge prose (`writing-great-skills`)
stakes the whole discipline on. Separately, plan 005 made an unfilled scaffolded
skill body carry a visible `forge:todo` sentinel, but nothing *fails* on it, so a
stub body can still ship green. This plan adds two deterministic, offline coverage
checks: (1) every skill-bearing plugin must ship ≥1 negative (`expect: null`)
case, and (2) no shipped skill body may still contain the `forge:todo` stub
marker.

**Safe for the current catalog** (verified): all five skill-bearing plugins
(`marketplace-builder`, `meta-generator`, `plugin-forge`, `plugin-validator`,
`release-manager`) already ship 2 negative cases each, and none of their
hand-written skill bodies contains `forge:todo`. `hello-objectcore` has no skill,
so it is skipped. So both new checks pass on the existing catalog —
`bun run check:catalog` and `bun run eval` stay green.

## Current state

`packages/eval/src/coverage.ts` — the whole file today:
```ts
import type { WorkspacePlugin } from "@objectcore/registry-core";
import { extractSurfaces } from "./trigger-surface";
import { loadActivationSpec } from "./activation";
import type { EvalResult } from "./types";

/** One result per skill: does at least one activation case expect it to fire? */
export async function runCoverageEvals(
  plugins: WorkspacePlugin[],
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  for (const plugin of plugins) {
    const skills = (await extractSurfaces(plugin)).filter((s) => s.kind === "skill");
    if (skills.length === 0) continue;
    const spec = await loadActivationSpec(plugin);
    const covered = new Set(
      (spec?.cases ?? []).map((c) => c.expect).filter((e): e is string => Boolean(e)),
    );
    for (const s of skills) {
      const passed = covered.has(s.name);
      results.push({
        suite: "coverage",
        plugin: plugin.manifest.name,
        name: `covers:${s.name}`,
        level: "error",
        passed,
        detail: passed
          ? `skill "${s.name}" has a positive activation case`
          : `skill "${s.name}" has no positive activation case — it would enter the catalog ungated`,
      });
    }
  }
  return results;
}
```
- `loadActivationSpec(plugin)` returns `{ cases: ActivationCase[] } | null`;
  `ActivationCase = { prompt: string; expect: string | null; note?: string }`.
- `EvalResult = { suite: "output"|"coverage"|"activation"; name: string; plugin?: string; passed: boolean; level: "error"|"warning"; detail: string }`.

`packages/eval/src/trigger-surface.ts` — extracts surfaces by walking
`skills/<entry>/SKILL.md`. It has `parseFrontmatter(raw)` exported and a private
`readSkillSurfaces`. A skill dir is `join(plugin.dir, plugin.manifest.skills ?? "skills")`.
**You will add an exported `readSkillBodies(plugin)` here** so the body check
reads files via the same dir-walk convention (entry-based, not surface-name
based) rather than reconstructing paths in coverage.ts. The existing private
helper to model after:
```ts
async function readSkillSurfaces(plugin, skillsDir): Promise<TriggerSurface[]> {
  if (!(await isDir(skillsDir))) return [];
  // walks readdir(skillsDir), reads join(skillsDir, entry, "SKILL.md"), parseFrontmatter, ...
}
```

`packages/eval/test/eval.test.ts` — the coverage test uses a `writePlugin(root,
name, skill, expectName)` helper that writes a plugin with one skill and one
activation case (`expect: expectName`). Note: today `writePlugin` writes only ONE
case, so a plugin it creates with a positive case has **no negative** — your new
negative-case gate must not retroactively break the *existing* coverage test.
Read that test (around line 110, "coverage: a skill with a matching positive case
passes; an uncovered skill fails") and the `writePlugin` helper (around line 86)
before editing, and extend `writePlugin` to also write a negative case where the
existing assertions still hold (see Step 3).

**Repo conventions:** results are `EvalResult` objects with `level: "error"` to
block the gate; `detail` is a one-line human explanation. Keep the eval package
dependency-light (it already imports only `node:fs` + registry-core types).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bunx tsc` | exit 0 |
| Eval tests | `bun test packages/eval/test/eval.test.ts` | all pass |
| All tests | `bun test` | all pass (currently 57) |
| Offline gate on the real catalog | `bun run check:catalog` | exit 0 |
| Output+coverage evals on real catalog | `bun run eval` | output+coverage green (activation skipped w/o key) |

## Scope

**In scope** (only these):
- `packages/eval/src/coverage.ts`
- `packages/eval/src/trigger-surface.ts` (add one exported helper)
- `packages/eval/test/eval.test.ts`

**Out of scope** (do NOT touch):
- `packages/forge/**` — the marker is produced there (plan 005, merged); this plan
  only *detects* it. Do not import from `@objectcore/forge` (avoids a forge↔eval
  cycle) — scan for the literal substring `forge:todo`.
- Any `plugins/**` — the existing plugins already satisfy both gates; if one does
  not, STOP and report (do not edit a plugin to make the gate pass).
- `packages/eval/src/activation.ts`, `output.ts`, `runner.ts`.

## Git workflow
- Branch: `advisor/006-eval-negative-and-stub-gates`
- One commit, plain imperative message. Do NOT push.

## Steps

### Step 1: Add `readSkillBodies` to trigger-surface.ts

Export a helper that returns each skill's raw SKILL.md content, walking the dir the
same way `readSkillSurfaces` does (entry-based):
```ts
/** Raw SKILL.md content per skill (entry-based walk), for body-quality checks
 *  like the unfilled-stub gate. */
export async function readSkillBodies(
  plugin: WorkspacePlugin,
): Promise<{ name: string; raw: string }[]> {
  const skillsDir = join(plugin.dir, plugin.manifest.skills ?? "skills");
  if (!(await isDir(skillsDir))) return [];
  const out: { name: string; raw: string }[] = [];
  for (const entry of (await readdir(skillsDir)).sort()) {
    if (entry.startsWith(".")) continue;
    const skillMd = join(skillsDir, entry, "SKILL.md");
    let raw: string;
    try {
      raw = await readFile(skillMd, "utf8");
    } catch {
      continue;
    }
    const fm = parseFrontmatter(raw);
    out.push({ name: fm.name || entry, raw });
  }
  return out;
}
```
(`readdir`, `readFile`, `join`, `isDir`, `parseFrontmatter` are all already in
this file.)

**Verify**: `bunx tsc` → exit 0.

### Step 2: Add the two gates to coverage.ts

In `runCoverageEvals`, after the existing positive-case loop for a plugin, add (a)
the negative-case requirement and (b) the stub-body check. Import `readSkillBodies`
from `./trigger-surface`.

```ts
    // (a) The negative half: a skill-bearing plugin must ship at least one
    // negative (expect:null) case, so "stays quiet on near-misses" is gated too.
    const hasNegative = (spec?.cases ?? []).some((c) => c.expect === null);
    results.push({
      suite: "coverage",
      plugin: plugin.manifest.name,
      name: "has-negative-case",
      level: "error",
      passed: hasNegative,
      detail: hasNegative
        ? "has at least one negative (expect:null) activation case"
        : "no negative activation case — the 'stays quiet on near-misses' half is ungated",
    });

    // (b) No shipped skill may still carry the forge:todo stub marker (plan 005).
    for (const { name, raw } of await readSkillBodies(plugin)) {
      const isStub = raw.includes("forge:todo");
      results.push({
        suite: "coverage",
        plugin: plugin.manifest.name,
        name: `body-filled:${name}`,
        level: "error",
        passed: !isStub,
        detail: isStub
          ? `skill "${name}" still has the forge:todo stub body — replace it with real instructions`
          : `skill "${name}" body is filled in`,
      });
    }
```
Place both blocks inside the `for (const plugin of plugins)` loop, after the
existing `for (const s of skills)` positive-case loop and before the loop closes.
(They run only when `skills.length > 0`, which the early `continue` already
guarantees.)

**Verify**: `bunx tsc` → exit 0; `bun run eval` → output+coverage green on the
real catalog (all 5 skill-bearing plugins already have negatives and filled
bodies — if any fails, STOP and report which plugin).

### Step 3: Tests

In `packages/eval/test/eval.test.ts`:

1. **Fix the existing `writePlugin` helper** so plugins it creates also carry a
   negative case (otherwise your new gate fails the existing coverage test). Change
   its activation write to include both the given case and a negative:
   ```ts
   JSON.stringify({ cases: [{ prompt: "p", expect: expectName }, { prompt: "n", expect: null }] }) + "\n",
   ```
   This keeps the existing assertions valid: the "wired" plugin still has its
   positive case (passes `covers:`), and the "ungated" plugin still has no positive
   for its skill (still fails `covers:`). Both now have a negative, so the new
   `has-negative-case` check passes for both and doesn't interfere.

2. **Add a negative-gate test** — a plugin whose only case is positive (no
   negative) fails `has-negative-case`:
   ```ts
   test("coverage: a skill-bearing plugin with no negative case fails has-negative-case", async () => {
     const root = await mkdtemp(join(tmpdir(), "cov-neg-"));
     try {
       const dir = join(root, "no-neg");
       await mkdir(join(dir, ".claude-plugin"), { recursive: true });
       await writeFile(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "no-neg", version: "0.0.1", description: "d" }) + "\n");
       await mkdir(join(dir, "skills", "s"), { recursive: true });
       await writeFile(join(dir, "skills", "s", "SKILL.md"), `---\nname: s\ndescription: d\n---\nreal body here\n`);
       await mkdir(join(dir, "evals"), { recursive: true });
       await writeFile(join(dir, "evals", "activation.json"), JSON.stringify({ cases: [{ prompt: "p", expect: "s" }] }) + "\n");
       const plugins = await new GitWorkspaceSource(root).listPlugins();
       const results = await runCoverageEvals(plugins);
       const neg = results.find((r) => r.plugin === "no-neg" && r.name === "has-negative-case");
       expect(neg?.passed).toBe(false);
       expect(neg?.level).toBe("error");
     } finally {
       await rm(root, { recursive: true, force: true });
     }
   });
   ```

3. **Add a stub-body test** — a skill whose body contains `forge:todo` fails
   `body-filled:`:
   ```ts
   test("coverage: a skill body still carrying the forge:todo stub fails body-filled", async () => {
     const root = await mkdtemp(join(tmpdir(), "cov-stub-"));
     try {
       const dir = join(root, "stubby");
       await mkdir(join(dir, ".claude-plugin"), { recursive: true });
       await writeFile(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "stubby", version: "0.0.1", description: "d" }) + "\n");
       await mkdir(join(dir, "skills", "s"), { recursive: true });
       await writeFile(join(dir, "skills", "s", "SKILL.md"), `---\nname: s\ndescription: d\n---\n<!-- forge:todo --> unfilled\n`);
       await mkdir(join(dir, "evals"), { recursive: true });
       await writeFile(join(dir, "evals", "activation.json"), JSON.stringify({ cases: [{ prompt: "p", expect: "s" }, { prompt: "n", expect: null }] }) + "\n");
       const plugins = await new GitWorkspaceSource(root).listPlugins();
       const results = await runCoverageEvals(plugins);
       const body = results.find((r) => r.plugin === "stubby" && r.name === "body-filled:s");
       expect(body?.passed).toBe(false);
     } finally {
       await rm(root, { recursive: true, force: true });
     }
   });
   ```

**Verify**: `bun test packages/eval/test/eval.test.ts` → all pass (existing +
2 new). `bun test` → 57 + 2 = 59.

### Step 4: Commit on `advisor/006-eval-negative-and-stub-gates`.

## Test plan
- Extend `writePlugin` to include a negative case (keeps existing coverage test
  valid). Add 2 tests: no-negative → fails `has-negative-case`; `forge:todo` body
  → fails `body-filled:`. Pattern: the existing coverage test in the same file.
- Verification: `bun test` → all pass (59); `bun run eval` → output+coverage green
  on the real catalog.

## Done criteria
ALL must hold:
- [ ] `bunx tsc` exits 0
- [ ] `bun test` exits 0 (59 total); the 2 new tests pass; the existing coverage
      test still passes
- [ ] `bun run check:catalog` exits 0 and `bun run eval` shows output+coverage
      green on the real catalog (activation skipped w/o key, never failed)
- [ ] `git diff --name-only 9beeee8..HEAD` lists exactly the 3 in-scope files
- [ ] No `plugins/**` file changed (`git status`)

## STOP conditions
Stop and report if:
- `coverage.ts` or `trigger-surface.ts` does not match the "Current state" excerpts.
- A *real* existing plugin fails `has-negative-case` or `body-filled:` — that
  contradicts the safety check in this plan; report which plugin rather than
  editing the plugin.
- You find yourself needing to import from `@objectcore/forge` — don't; scan for
  the literal `forge:todo`.
- A verification fails twice after a reasonable fix.

## Maintenance notes
- The negative-case gate is per *plugin*, not per skill — a plugin with several
  skills needs at least one negative overall. If a future plan wants per-skill
  confusability negatives, build on this rather than replacing it.
- Plan 007 (forge prose) documents these two new requirements for authors so the
  prose matches what the gate enforces; do 007 after this so the prose is accurate.
- The body check scans the raw SKILL.md (frontmatter included) for `forge:todo`;
  a real skill never contains that literal. If forge's marker string changes in
  `packages/forge/src/scaffold.ts`, update the literal here in lockstep (the two
  are intentionally decoupled by a shared convention, not an import).
