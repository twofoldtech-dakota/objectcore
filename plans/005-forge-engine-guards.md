# Plan 005: Harden the forge scaffold engine — pre-write activation↔skill cross-validation + a visible stub marker

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. Touch
> only the in-scope files. If a STOP condition occurs, stop and report. When done,
> update the status row for this plan in `plans/README.md` (unless a reviewer told
> you they maintain the index).
>
> **Drift check (run first)**: `git diff --stat cdd41ba..HEAD -- packages/forge/src/scaffold.ts packages/forge/test/scaffold.test.ts`
> If either in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (plan 006 depends on THIS — it scans for the marker defined here)
- **Category**: tech-debt / dx (hardening the generator)
- **Planned at**: commit `cdd41ba`, 2026-06-25

## Why this matters

The 003 forge spike (`plans/notes/003-forge-spike-findings.md`) found two engine
gaps. (1) `scaffoldPlugin` validates kebab-case, `repository`, and "skills must
ship activation cases" **before** writing, but does **not** check that each
`activation[].expect` names a real skill or that each skill has a *positive* case
— a typo like `expect: "writing-commit-message"` (missing the `s`) writes the
whole plugin dir, then fails the coverage eval afterward, leaving a half-written
directory the next run must `--force` over. (2) The generated default skill body
just restates the frontmatter description plus boilerplate, so a never-filled
skill body silently masquerades as finished. This plan moves the cross-check
*before* the write and makes an unfinished body **visibly** unfinished with a
sentinel marker (`<!-- forge:todo -->`) that a later eval (plan 006) can fail on.

This change only affects **future scaffolds** — the six existing plugins have
hand-written bodies and are untouched, so `check:catalog` and the existing evals
stay green.

## Current state

`packages/forge/src/scaffold.ts` — the deterministic scaffolder. Relevant parts:

The default skill body (lines ~37-44):
```ts
function defaultSkillBody(s: ComponentSpec): string {
  return `# ${titleCase(s.name)}

${s.description}

Keep the description in the frontmatter precise: it is the trigger surface that decides whether this skill fires. Most skill failures are description failures, not body failures. Load deeper reference only when the task actually needs it.
`;
}
```

The pre-write guard block inside `scaffoldPlugin` (lines ~71-88):
```ts
  if (!KEBAB.test(spec.name)) throw new Error(`plugin name "${spec.name}" must be kebab-case`);
  if (!spec.description?.trim()) throw new Error("plugin spec needs a non-empty description");
  if (spec.repository !== undefined && typeof spec.repository !== "string") {
    throw new Error("`repository` must be a string");
  }
  if (skills.length + commands.length === 0) {
    throw new Error("a plugin needs at least one component (skill or command)");
  }
  for (const c of [...skills, ...commands]) {
    if (!KEBAB.test(c.name)) throw new Error(`component name "${c.name}" must be kebab-case`);
  }
  // The factory rule: a skill that never fires is worse than one that fails to
  // parse, so a plugin with skills must ship activation cases to gate them.
  if (skills.length > 0 && !(spec.activation && spec.activation.length)) {
    throw new Error(
      "plugin has skills but no activation cases — every skill must ship an activation eval",
    );
  }
```
where `const skills = spec.skills ?? []` and `const commands = spec.commands ?? []`
are set at the top of the function, and `ActivationCase` is
`{ prompt: string; expect: string | null; note?: string }`.

`packages/forge/test/scaffold.test.ts` — uses a tmpdir helper and asserts
scaffold behavior. The existing happy-path spec (test at line ~22) uses
`skills: [{ name: "do-the-thing", ... }]` with
`activation: [{ prompt: "...", expect: "do-the-thing" }, { prompt: "...", expect: null }]`
— note it has a positive case whose `expect` matches the skill name, so it will
still pass the new guard. There is already a test
`"scaffoldPlugin refuses a skill without activation cases (the gate rule)"`
asserting `.rejects.toThrow(/activation/)`.

**Repo conventions to match:**
- Guards throw a plain `Error` with a one-line message naming the offending
  symbol — match the existing throw style in `scaffold.ts`.
- Tests are `bun:test`, use the `tmp()` helper already in `scaffold.test.ts`, and
  wrap in `try/finally` with `rm(dir, { recursive: true, force: true })`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bunx tsc` | exit 0 |
| Forge tests | `bun test packages/forge/test/scaffold.test.ts` | all pass |
| All tests | `bun test` | all pass (currently 54) |
| Catalog gate (unaffected) | `bun run check:catalog` | exit 0, "in sync" |

## Scope

**In scope** (only these):
- `packages/forge/src/scaffold.ts`
- `packages/forge/test/scaffold.test.ts`

**Out of scope** (do NOT touch):
- `packages/eval/**` — the *eval* that fails on the marker is plan 006, not this.
- Any plugin under `plugins/**` — existing plugins have hand-written bodies and
  must not change; `check:catalog` must stay byte-exact.
- `packages/forge/src/meta.ts` — `metaPluginSpec` already guarantees a positive
  case; do not change it (verify the existing meta test still passes).

## Git workflow
- Branch: `advisor/005-forge-engine-guards`
- One commit, plain imperative message.
- Do NOT push or open a PR.

## Steps

### Step 1: Add the stub marker and use it in the default skill body

In `packages/forge/src/scaffold.ts`, add a module-level exported constant and
rewrite `defaultSkillBody` to emit it instead of restating the description:

```ts
/** Sentinel marking an unfilled scaffolded skill body. Plan 006's eval fails any
 *  shipped skill whose body still contains it, so a stub can't masquerade as done.
 *  Kept as a plain string (no cross-package import) — eval scans for this literal. */
export const FORGE_STUB_MARKER = "<!-- forge:todo -->";

function defaultSkillBody(s: ComponentSpec): string {
  return `# ${titleCase(s.name)}

${FORGE_STUB_MARKER} Replace this stub with the real skill instructions — what to do,
the steps, the output format, and any reference to load. The frontmatter \`description\`
is the trigger surface (it decides firing); this body is what runs once the skill fires.
`;
}
```

**Verify**: `bunx tsc` → exit 0.

### Step 2: Add the pre-write cross-validation guard

In `scaffoldPlugin`, immediately AFTER the existing "skills but no activation
cases" check (the last guard in the block shown in Current state) and BEFORE the
`const dir = join(pluginsDir, spec.name);` line, add:

```ts
  // Cross-check activation cases against the declared skills BEFORE writing, so a
  // typo'd spec fails cleanly instead of leaving a half-scaffolded dir for --force.
  if (skills.length > 0) {
    const skillNames = new Set(skills.map((s) => s.name));
    for (const c of spec.activation ?? []) {
      if (c.expect !== null && !skillNames.has(c.expect)) {
        throw new Error(
          `activation case expects "${c.expect}" but no such skill is declared`,
        );
      }
    }
    for (const s of skills) {
      const hasPositive = (spec.activation ?? []).some((c) => c.expect === s.name);
      if (!hasPositive) {
        throw new Error(
          `skill "${s.name}" has no positive activation case (expect: "${s.name}")`,
        );
      }
    }
  }
```

**Verify**: `bunx tsc` → exit 0; then `bun test packages/forge/test/scaffold.test.ts`
→ the existing tests still pass (the happy-path spec has a matching positive case;
`metaPluginSpec` guarantees one).

### Step 3: Test the new guards and the marker

In `packages/forge/test/scaffold.test.ts`, add three tests (reuse the `tmp()`
helper, `try/finally` cleanup, and imports already in the file):

```ts
test("scaffoldPlugin rejects an activation case that names an undeclared skill", async () => {
  const dir = await tmp();
  try {
    await expect(
      scaffoldPlugin(
        {
          name: "typo-plugin",
          description: "x",
          skills: [{ name: "do-thing", description: "d" }],
          activation: [{ prompt: "p", expect: "do-thing" }], // typo
        },
        dir,
      ),
    ).rejects.toThrow(/no such skill is declared/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scaffoldPlugin rejects a skill with only a negative case (no positive)", async () => {
  const dir = await tmp();
  try {
    await expect(
      scaffoldPlugin(
        {
          name: "neg-only",
          description: "x",
          skills: [{ name: "do-thing", description: "d" }],
          activation: [{ prompt: "p", expect: null }],
        },
        dir,
      ),
    ).rejects.toThrow(/no positive activation case/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a scaffolded skill with no body gets the visible forge:todo stub marker", async () => {
  const dir = await tmp();
  try {
    const { dir: pluginDir } = await scaffoldPlugin(
      {
        name: "stub-body",
        description: "x",
        skills: [{ name: "do-thing", description: "Use when the user wants the thing." }],
        activation: [{ prompt: "do the thing", expect: "do-thing" }],
      },
      dir,
    );
    const body = await readFile(
      join(pluginDir, "skills", "do-thing", "SKILL.md"),
      "utf8",
    );
    expect(body).toContain("forge:todo");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

(`scaffoldPlugin`, `readFile`, `join`, `rm`, `tmp`, `test`, `expect` are all
already imported/defined at the top of the file.)

**Verify**: `bun test packages/forge/test/scaffold.test.ts` → all pass (existing +
3 new).

### Step 4: Commit
Commit both files on `advisor/005-forge-engine-guards`.

## Test plan
- 3 new tests in `scaffold.test.ts`: undeclared-skill expect throws; positive-less
  skill throws; default body contains `forge:todo`. Pattern: the existing
  `scaffold.test.ts` tests.
- Verification: `bun test` → all pass (54 + 3 = 57).

## Done criteria
ALL must hold:
- [ ] `bunx tsc` exits 0
- [ ] `bun test` exits 0 (57 total); the 3 new tests pass
- [ ] `bun run check:catalog` exits 0 — the six existing plugins are unchanged
      (the body change only affects *new* scaffolds)
- [ ] `grep -n "FORGE_STUB_MARKER" packages/forge/src/scaffold.ts` shows the
      exported constant used by `defaultSkillBody`
- [ ] Only the two in-scope files are modified (`git status`)
- [ ] `git diff --name-only cdd41ba..HEAD` lists exactly those two files

## STOP conditions
Stop and report if:
- `scaffold.ts` does not match the "Current state" excerpts (drift).
- Adding the positive-case guard breaks the existing happy-path or `metaPluginSpec`
  test — that would mean an existing spec lacks a matching positive case; report it
  rather than weakening the guard.
- `check:catalog` goes red (it should not — no plugin changed); report it.
- A verification fails twice after a reasonable fix.

## Maintenance notes
- Plan 006 adds an *eval* that fails any shipped skill body still containing
  `forge:todo`. Keep the marker literal stable (`<!-- forge:todo -->`); 006 scans
  for the substring `forge:todo` and does not import this constant (avoids a
  forge↔eval dependency cycle).
- The pre-write positive-case guard overlaps with the post-write coverage eval
  (`packages/eval/src/coverage.ts`) by design: failing *before* the write is the
  improvement. Do not remove the coverage eval — it still gates hand-written
  plugins that never go through `scaffoldPlugin`.
- Reviewer should confirm no existing plugin's `marketplace.json` entry changed.
