// Covers the release CLIs' git edge (scripts/_release.ts): a pin sha resolves from
// the RELEASE TAG (`rev-list -n1`, which peels annotated tags) — never bare HEAD —
// and content drift since the tag is detectable. This is the invariant behind
// release:publish / registry:publish tag-pinning: a post-release push to main must
// not silently move an "immutable" pin. Deterministic + offline (throwaway repo).

import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { tagSha, pathChangedSince, gitSha } from "../../../scripts/_release";

// Identity + signing pinned per-invocation so the test ignores the host's git config.
function run(cwd: string, args: string[]): void {
  execFileSync(
    "git",
    ["-c", "user.email=test@objectcore.test", "-c", "user.name=test", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", "core.autocrlf=false", ...args],
    { cwd, encoding: "utf8" },
  );
}

let repo: string;

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), "oc-release-git-"));
  run(repo, ["init", "-q"]);
  await mkdir(join(repo, "plugins", "demo"), { recursive: true });
  await writeFile(join(repo, "plugins", "demo", "file.txt"), "v1\n", "utf8");
  run(repo, ["add", "."]);
  run(repo, ["commit", "-q", "-m", "release demo 0.1.0"]);
  run(repo, ["tag", "-a", "demo--v0.1.0", "-m", "demo v0.1.0"]);
  // A later commit moves HEAD past the tag — the drift scenario.
  await writeFile(join(repo, "plugins", "demo", "file.txt"), "v2\n", "utf8");
  run(repo, ["add", "."]);
  run(repo, ["commit", "-q", "-m", "post-release edit without a changeset"]);
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
});

test("tagSha resolves the tag's commit, not HEAD (annotated tag peeled)", () => {
  const pinned = tagSha(repo, "demo--v0.1.0");
  expect(pinned).toMatch(/^[0-9a-f]{40}$/);
  expect(pinned).not.toBe(gitSha(repo));
});

test("pathChangedSince detects drift under the plugin dir since the tag", () => {
  const pinned = tagSha(repo, "demo--v0.1.0");
  expect(pathChangedSince(repo, pinned, "plugins/demo")).toBe(true);
  expect(pathChangedSince(repo, gitSha(repo), "plugins/demo")).toBe(false);
});

test("tagSha throws on a missing tag — fail closed, never fall back to HEAD", () => {
  expect(() => tagSha(repo, "demo--v9.9.9")).toThrow();
});
