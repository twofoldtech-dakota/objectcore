---
id: clean-git-treats-fresh-agent-branches-as-merged
type: gotcha
title: clean:git sees a not-yet-committed executor branch as merged — never run it while agent worktrees are live
tags: [git, worktrees, clean-git, orchestration]
source: scripts/clean-git.ts
created: 2026-07-02
---

A just-created executor branch (`git checkout -B feat/x origin/main` in an agent worktree) points AT main until its first commit, so `clean:git` classifies it as a merged branch and its worktree as removable — a dry-run during the plan-013 orchestration showed it would `git worktree remove --force` all three LIVE agent worktrees, destroying in-progress uncommitted work (locked status did not exempt them).

Rule: run `bun run clean:git` only when no executor/agent worktrees are active (or after every live branch carries at least one commit), and always `--dry-run` first when any `.claude/worktrees/` checkout exists.
