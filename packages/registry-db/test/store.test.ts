import { test, expect } from "bun:test";
import {
  deriveCatalog,
  RegistryDbSink,
  RegistryDbSource,
  type WorkspacePlugin,
} from "@objectcore/registry-core";
import { InMemoryCatalogStore } from "../src/memory";

const gitPlugins: WorkspacePlugin[] = [
  { manifest: { name: "alpha-plugin", version: "0.1.0", description: "Alpha", keywords: ["x"], license: "MIT" }, dir: "/x/plugins/alpha-plugin", relDir: "alpha-plugin" },
  { manifest: { name: "beta-plugin", version: "1.0.0", description: "Beta", author: { name: "Dakota" } }, dir: "/x/plugins/beta-plugin", relDir: "beta-plugin" },
];
const base = { name: "objectcore", owner: { name: "Dakota" }, pluginRoot: "./plugins" };
const repoUrl = "https://github.com/twofoldtech-dakota/objectcore";
const shaPin = { "alpha-plugin": "sha-alpha", "beta-plugin": "sha-beta" };

test("DB ingest -> serve round-trips to the same pinned catalog as the Git source", async () => {
  const store = new InMemoryCatalogStore();

  // Publish: derive the pinned catalog (Git source) and ingest it through the sink.
  const pinned = deriveCatalog(gitPlugins, { ...base, repoUrl, shaPin });
  await new RegistryDbSink(store, "stable").publish(pinned);

  // Serve: read rows back and re-derive with pins built from the SAME rows.
  const dbSource = new RegistryDbSource(store, "stable");
  const dbPlugins = await dbSource.listPlugins();
  const { shaPin: dbShaPin, repoUrl: dbRepoUrl } = await dbSource.pins();
  const served = deriveCatalog(dbPlugins, { ...base, repoUrl: dbRepoUrl, shaPin: dbShaPin });

  // The DB and Git sources yield the identical pinned catalog — one derivation path.
  expect(served).toEqual(pinned);
});

test("RegistryDbSource without a store preserves the Stage-3 throwing stub", async () => {
  await expect(new RegistryDbSource().listPlugins()).rejects.toThrow(/not wired yet/);
});

test("RegistryDbSink refuses an unpinned (bare-path) entry", async () => {
  const store = new InMemoryCatalogStore();
  const bare = deriveCatalog(gitPlugins, base); // no shaPin -> string sources
  await expect(new RegistryDbSink(store).publish(bare)).rejects.toThrow(/not pinned/);
});
