import { test, expect } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitWorkspaceSource, RegistryDbSource } from "../src/sources";
import type { CatalogStore, StoredPlugin } from "../src/sources";

const row = (name: string, over: Partial<StoredPlugin> = {}): StoredPlugin => ({
  manifest: { name, version: "0.1.0" },
  relDir: name,
  version: "0.1.0",
  sha: `sha-${name}`,
  ref: `${name}--v0.1.0`,
  repoUrl: "https://github.com/twofoldtech-dakota/objectcore",
  ...over,
});

/** A stub store scripted per-call — lets tests exercise error paths without a DB. */
class ScriptedStore implements CatalogStore {
  private call = 0;
  constructor(private readonly script: Array<StoredPlugin[] | Error>) {}
  async listLatest(): Promise<StoredPlugin[]> {
    const step = this.script[Math.min(this.call++, this.script.length - 1)]!;
    if (step instanceof Error) throw step;
    return step;
  }
  async upsertVersion(): Promise<void> {}
  async setChannel(): Promise<void> {}
}

test("GitWorkspaceSource names the file on a malformed plugin.json", async () => {
  const root = await mkdtemp(join(tmpdir(), "src-"));
  try {
    await mkdir(join(root, "broken-plugin", ".claude-plugin"), { recursive: true });
    await writeFile(join(root, "broken-plugin", ".claude-plugin", "plugin.json"), "{bad,}", "utf8");
    await expect(new GitWorkspaceSource(root).listPlugins()).rejects.toThrow(
      /invalid JSON in .*plugin\.json/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("RegistryDbSource.pins() fails closed when rows span multiple repoUrls", async () => {
  const store = new ScriptedStore([
    [row("alpha-plugin"), row("beta-plugin", { repoUrl: "https://github.com/other/repo" })],
  ]);
  await expect(new RegistryDbSource(store).pins()).rejects.toThrow(/multiple repoUrls/);
});

test("RegistryDbSource serves the last-known-good catalog when the store read fails", async () => {
  const store = new ScriptedStore([[row("alpha-plugin")], new Error("turso blip")]);
  const source = new RegistryDbSource(store, "stable", 0); // ttl 0: every call hits the store
  expect((await source.listPlugins()).map((p) => p.manifest.name)).toEqual(["alpha-plugin"]);
  // Second read throws in the store; the source rides it out with the stale snapshot.
  expect((await source.listPlugins()).map((p) => p.manifest.name)).toEqual(["alpha-plugin"]);
});

test("RegistryDbSource rethrows a store error when no snapshot exists yet", async () => {
  const store = new ScriptedStore([new Error("cold start, DB down")]);
  await expect(new RegistryDbSource(store).listPlugins()).rejects.toThrow(/DB down/);
});
