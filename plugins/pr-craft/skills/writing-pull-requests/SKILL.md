---
name: writing-pull-requests
description: Draft a pull-request title and description that summarize the commits on a branch relative to its base branch. Use when the user is opening a pull request, asks for a PR description or title, or wants a branch summarized for reviewers.
---
# Writing Pull Requests

Turn a branch's worth of commits into a reviewer-ready PR title and description. A commit message explains one change; a PR explains the *whole* change and what a reviewer should look at.

## Steps
1. Establish the range. Find the base (usually `main`) and diff the branch against it: `git log --oneline $(git merge-base HEAD main)..HEAD` for the commits and `git diff $(git merge-base HEAD main)...HEAD --stat` for the shape. Identify the single theme of the branch.
2. Write the **title** — one line, like a Conventional Commits subject for the whole branch: `type(scope): summary`, imperative mood, ≤ ~72 chars, no trailing period. On a squash-merge repo this becomes the commit that lands on `main`, so make it self-contained.
3. Write the **description** with these sections (drop any that are empty):
   - **What & why** — the problem and the chosen approach, in 1–3 sentences. Lead with motivation; reviewers need *why* before *how*.
   - **Changes** — a short bulleted list of the meaningful changes, grouped by area. Summarize intent; do **not** paste the commit log verbatim.
   - **Testing** — how it was verified (commands run, cases covered, manual steps). If untested, say so.
   - **Notes / risks** — migrations, rollout/flag steps, breaking changes, and anything intentionally left out of scope.
4. **Link issues** with closing keywords so the PR auto-closes them on merge: `Closes #123`, `Fixes #123`, or `Refs #123` for a non-closing reference.
5. **Point reviewers** at the hotspots — name the files or decisions that need the most scrutiny, and call out anything you're unsure about.

## Rules
- Summarize the branch's intent; don't narrate each commit.
- Keep the title independent of the body — it must stand alone in `git log` after a squash-merge.
- Mark breaking changes explicitly and describe the migration path.
- If the branch mixes unrelated work, say so and suggest splitting it into separate PRs.
- Match the repo's PR template if one exists (`.github/pull_request_template.md`); these sections are the fallback.

## Example
```
feat(auth): add refresh-token rotation

## What & why
Long-lived refresh tokens are a replay risk if leaked. Rotate the refresh
token on every use and revoke the prior one, closing the replay window.

## Changes
- Issue a new refresh token on each `/token` exchange; revoke the old one
- Add a `token_family` column to detect and block reuse of a revoked token
- Backfill existing sessions in a migration

## Testing
- `bun test packages/auth` — new rotation + reuse-detection cases
- Manual: logged in, refreshed twice, confirmed the first token 401s

## Notes
- Requires the `2026_06_auth_rotation` migration before deploy.

Closes #214
```
