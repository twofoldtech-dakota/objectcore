---
name: writing-commit-messages
description: Draft a clear, conventional-commits-style git commit message that summarizes the staged diff. Use when the user is about to commit, asks for a commit message, or wants their commit wording improved.
---
# Writing Commit Messages

Draft a commit message from the staged changes, in Conventional Commits form.

## Steps
1. Read the staged diff — `git diff --cached`. If nothing is staged, fall back to `git diff` and say so. Identify the dominant change.
2. Pick the **type**: `feat` | `fix` | `refactor` | `perf` | `docs` | `test` | `build` | `ci` | `chore`. If the change spans several, choose the one carrying the user-facing intent and mention the rest in the body.
3. Pick an optional **scope** — the package, module, or area touched, e.g. `feat(parser):`. Omit it when the change is broad.
4. Write the **subject**: `type(scope): summary` — imperative mood ("add", not "added"/"adds"), ≤ ~72 chars, lower-case after the colon, no trailing period.
5. Add a **body** only when the *why* isn't obvious from the subject: what changed and why, wrapped at ~72 columns, separated from the subject by a blank line.
6. **Footers**: reference issues (`Refs #123`, `Closes #123`). For a breaking change, add a `!` after the type/scope (`feat(api)!:`) and a `BREAKING CHANGE: <what breaks + migration>` footer.

## Rules
- Describe what the change does, not what you did ("add retry to fetch", not "I added a retry").
- One logical change per commit. If the staged diff mixes unrelated changes, say so and suggest splitting.
- Summarize intent; don't narrate the diff line by line.

## Example
```
feat(auth): add refresh-token rotation

Rotate the refresh token on every use and revoke the prior one, closing
the replay window if a token leaks.

Closes #214
```
