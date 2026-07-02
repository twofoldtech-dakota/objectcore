#!/usr/bin/env bun
/**
 * Git hygiene maintenance — prune stale worktrees and delete branches already
 * merged into the trunk. This is the durable answer to agent-run residue piling
 * up (isolated `.claude/worktrees/*` checkouts + their `worktree-agent-*` /
 * `advisor/*` branches): run it whenever the working copy gets noisy.
 *
 * Safe by default — it only ever touches things that are provably merged, and it
 * never removes the trunk or the worktree/branch you're currently on.
 *
 *   bun run clean:git              prune worktree admin + remove merged non-trunk
 *                                  worktrees + delete merged local branches
 *   bun run clean:git --dry-run    print exactly what WOULD happen; change nothing
 *   bun run clean:git --gone       ALSO delete branches whose upstream was deleted
 *                                  (the squash-merge case: merged on GitHub but not
 *                                  an ancestor of trunk locally). Uses force-delete.
 *   bun run clean:git --remote     ALSO `git fetch --prune` to drop stale
 *                                  remote-tracking refs that point at deleted branches
 *
 * Zero-dep on purpose (just `node:child_process`), matching the rest of the repo.
 */
import { execFileSync } from "node:child_process";

const TRUNK = "main";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const alsoGone = args.has("--gone");
const alsoRemote = args.has("--remote");

/** Run git, return trimmed stdout. */
function git(...a: string[]): string {
  return execFileSync("git", a, { encoding: "utf8" }).trim();
}

/** Run a mutating git command, or just announce it under --dry-run. */
function act(label: string, ...a: string[]): void {
  if (dryRun) {
    console.log(`  [dry-run] would ${label}: git ${a.join(" ")}`);
    return;
  }
  try {
    const out = git(...a);
    console.log(`  ${label}${out ? `: ${out.split("\n")[0]}` : ""}`);
  } catch (e) {
    console.log(`  SKIP ${label} — ${(e as Error).message.split("\n")[0]}`);
  }
}

const currentBranch = git("rev-parse", "--abbrev-ref", "HEAD");
console.log(
  `git hygiene — trunk=${TRUNK}, current=${currentBranch}${dryRun ? " (DRY RUN)" : ""}`,
);

// 1) Optionally sync remote-tracking refs first, so "merged" reflects the remote.
if (alsoRemote) {
  console.log("\n[remote] fetch --prune");
  act("fetch --prune", "fetch", "--prune");
}

// 2) Remove merged non-trunk worktrees, then prune leftover admin entries.
//    Parse `git worktree list --porcelain`: blocks of `worktree <path>` + a
//    `branch refs/heads/<name>` (or `detached`/`bare`) line.
console.log("\n[worktrees]");
const merged = new Set(
  git("branch", "--format=%(refname:short)", "--merged", TRUNK)
    .split("\n")
    .filter(Boolean),
);
const porcelain = git("worktree", "list", "--porcelain");
let path = "";
let removedWorktree = false;
for (const line of porcelain.split("\n")) {
  if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
  else if (line === "" && path) path = "";
  else if (line.startsWith("branch ")) {
    const branch = line.slice("branch refs/heads/".length);
    const isMainWorktree = path.replace(/\\/g, "/").endsWith("/objectcore");
    // Only reap a worktree whose checked-out branch is merged into trunk and is
    // neither the trunk nor the one we're standing in.
    if (
      !isMainWorktree &&
      branch !== TRUNK &&
      branch !== currentBranch &&
      merged.has(branch)
    ) {
      act(`remove worktree ${path} (${branch} merged)`, "worktree", "remove", "--force", path);
      removedWorktree = true;
    }
    path = "";
  }
}
if (!removedWorktree && !dryRun) console.log("  no merged worktrees to remove");
act("prune worktree admin", "worktree", "prune", "-v");

// 3) Delete local branches that are ancestors of trunk (true merges).
console.log("\n[merged branches]");
const toDelete = [...merged].filter((b) => b !== TRUNK && b !== currentBranch);
if (toDelete.length === 0) {
  console.log("  none merged into trunk");
} else {
  for (const b of toDelete) act(`delete ${b}`, "branch", "-d", b);
}

// 4) Optionally delete branches whose upstream is gone (squash-merge residue).
//    These are NOT ancestors of trunk, so this requires --gone + force-delete.
if (alsoGone) {
  console.log("\n[gone upstream]");
  const goneBranches = git("branch", "-vv")
    .split("\n")
    // `*` marks the current branch, `+` a branch checked out in another worktree.
    .map((l) => l.replace(/^[*+]?\s+/, ""))
    .filter((l) => /\[[^\]]+: gone\]/.test(l))
    .map((l) => l.split(/\s+/)[0])
    .filter((b) => b && b !== TRUNK && b !== currentBranch);
  if (goneBranches.length === 0) console.log("  none with a deleted upstream");
  else for (const b of goneBranches) act(`force-delete ${b} (upstream gone)`, "branch", "-D", b);
}

console.log(`\n${dryRun ? "Dry run complete — nothing changed." : "Done."}`);
