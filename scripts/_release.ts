// Shared I/O helpers for the release CLIs (release-status / release-version /
// release-publish), mirroring scripts/_workspace.ts and scripts/_finalize.ts. The
// pure logic lives in @objectcore/release; this file is the disk + git edge. Not a
// runnable script (underscore prefix).

import { readdir, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { parseChangeset, MCP_CONFIG_FILES, type Changeset } from "@objectcore/release";

export const CHANGESET_DIR = ".changeset";

/** Read every `.changeset/*.md` (excluding README) into parsed changesets. */
export async function readChangesets(root: string): Promise<Changeset[]> {
  const dir = join(root, CHANGESET_DIR);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: Changeset[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".md")) continue;
    if (name.toLowerCase() === "readme.md") continue;
    const raw = await readFile(join(dir, name), "utf8");
    out.push(parseChangeset(name.replace(/\.md$/, ""), raw));
  }
  return out;
}

/** Replace the FIRST `"version": "..."` in a JSON string, preserving formatting.
 *  Falls back to parse+reserialize if the field is absent. */
export function setJsonVersion(raw: string, newVersion: string): string {
  const re = /("version"\s*:\s*")[^"]*(")/;
  if (re.test(raw)) return raw.replace(re, `$1${newVersion}$2`);
  const obj = JSON.parse(raw) as Record<string, unknown>;
  obj.version = newVersion;
  return JSON.stringify(obj, null, 2) + "\n";
}

/** Run git in the repo and return trimmed stdout. */
export function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

export function gitSha(root: string): string {
  return git(root, ["rev-parse", "HEAD"]);
}

/** The commit a release tag points at (`rev-list -n1` peels annotated tags).
 *  Pin shas must resolve from the tag, never bare HEAD — a post-release push to
 *  main would otherwise silently drift an "immutable" pin away from its tag.
 *  Throws when the tag does not exist (fail closed; no HEAD fallback). */
export function tagSha(root: string, tag: string): string {
  return git(root, ["rev-list", "-n", "1", tag]);
}

/** True when `path` differs between `sha` and HEAD — untagged content drift that
 *  would ship under an old version if pinned anyway. */
export function pathChangedSince(root: string, sha: string, path: string): boolean {
  try {
    git(root, ["diff", "--quiet", sha, "HEAD", "--", path]);
    return false;
  } catch {
    return true;
  }
}

export function existingTags(root: string): Set<string> {
  try {
    return new Set(
      git(root, ["tag", "--list"]).split("\n").map((s) => s.trim()).filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

/** The repo's https URL (for git-subdir pins), derived from `origin`. */
export function repoUrl(root: string): string {
  let raw = "";
  try {
    raw = git(root, ["config", "--get", "remote.origin.url"]);
  } catch {
    /* no remote */
  }
  return normalizeRepoUrl(raw);
}

/** git@github.com:owner/repo.git -> https://github.com/owner/repo (and strip .git). */
export function normalizeRepoUrl(raw: string): string {
  const u = raw.trim();
  if (!u) return "";
  const ssh = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(u);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  return u.replace(/\.git$/, "");
}

/** True if the plugin dir bundles an MCP server config (provenance gate). */
export async function hasMcpConfig(dir: string): Promise<boolean> {
  for (const f of MCP_CONFIG_FILES) {
    try {
      await access(join(dir, f));
      return true;
    } catch {
      /* not present */
    }
  }
  return false;
}
