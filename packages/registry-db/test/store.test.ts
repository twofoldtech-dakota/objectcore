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

test("RegistryDbSink rejects the whole catalog before any write when a LATER entry is unpinned", async () => {
  const store = new InMemoryCatalogStore();
  // zeta is versioned but absent from shaPin -> bare-path entry, sorting AFTER the
  // pinned ones — exactly the input that used to abort the write loop mid-catalog.
  const mixed = deriveCatalog(
    [
      ...gitPlugins,
      { manifest: { name: "zeta-plugin", version: "1.0.0", description: "Zeta" }, dir: "/x/plugins/zeta-plugin", relDir: "zeta-plugin" },
    ],
    { ...base, repoUrl, shaPin },
  );
  await expect(new RegistryDbSink(store).publish(mixed)).rejects.toThrow(/zeta-plugin/);
  // No partial write: the pinned entries that sorted first were NOT ingested.
  expect(await store.listLatest("stable")).toEqual([]);
});

// ── version immutability (first-write-wins) ────────────────────────────────────

const alphaStored = () => ({
  manifest: gitPlugins[0]!.manifest,
  relDir: "alpha-plugin",
  version: "0.1.0",
  sha: "sha-alpha",
  ref: "alpha-plugin--v0.1.0",
  repoUrl,
});

test("upsertVersion is idempotent for identical coordinates but throws on drift", async () => {
  const store = new InMemoryCatalogStore();
  await store.upsertVersion(alphaStored());
  await store.setChannel("stable", "alpha-plugin", "0.1.0");

  // Identical re-publish: a no-op, not an error.
  await store.upsertVersion(alphaStored());
  expect((await store.listLatest("stable"))[0]!.sha).toBe("sha-alpha");

  // A different sha for the same version is drift — published versions are immutable.
  await expect(store.upsertVersion({ ...alphaStored(), sha: "sha-head" })).rejects.toThrow(/immutable/);
  // A different manifest is drift too.
  await expect(
    store.upsertVersion({ ...alphaStored(), manifest: { ...gitPlugins[0]!.manifest, description: "edited" } }),
  ).rejects.toThrow(/immutable/);
  // The first write survives.
  expect((await store.listLatest("stable"))[0]!.sha).toBe("sha-alpha");
});

test("provenance backfills on an identical re-publish and is never wiped by undefined", async () => {
  const store = new InMemoryCatalogStore();
  await store.upsertVersion(alphaStored()); // no provenance yet
  await store.setChannel("stable", "alpha-plugin", "0.1.0");

  // Backfill: the one column a re-publish may add/update.
  await store.upsertVersion({ ...alphaStored(), provenance: { ref: "att://run-1" } });
  expect((await store.listLatest("stable"))[0]!.provenance).toEqual({ ref: "att://run-1" });

  // Preserve: undefined incoming provenance never clobbers a stored one.
  await store.upsertVersion(alphaStored());
  expect((await store.listLatest("stable"))[0]!.provenance).toEqual({ ref: "att://run-1" });
});

test("break-glass ingest (RegistryDbSink) preserves provenance written by OIDC publish", async () => {
  const store = new InMemoryCatalogStore();
  // OIDC publish shape: the version row lands with its attestation reference.
  await store.upsertVersion({ ...alphaStored(), provenance: { ref: "att://oidc" } });
  await store.upsertVersion({
    manifest: gitPlugins[1]!.manifest,
    relDir: "beta-plugin",
    version: "1.0.0",
    sha: "sha-beta",
    ref: "beta-plugin--v1.0.0",
    repoUrl,
    provenance: { ref: "att://oidc" },
  });

  // Break-glass ingest of the same pinned catalog (entries carry no provenance).
  const pinned = deriveCatalog(gitPlugins, { ...base, repoUrl, shaPin });
  await new RegistryDbSink(store, "stable").publish(pinned);

  for (const r of await store.listLatest("stable")) {
    expect(r.provenance).toEqual({ ref: "att://oidc" });
  }
});
