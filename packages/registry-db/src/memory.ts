// InMemoryCatalogStore — a dependency-free `CatalogStore` for tests and local dev
// (no DB configured). Same contract as LibSqlCatalogStore; useful to exercise the
// ingest -> serve round-trip without a libSQL connection.

import type { CatalogStore, StoredPlugin } from "@objectcore/registry-core";
import { assertVersionImmutable } from "./immutable";

export class InMemoryCatalogStore implements CatalogStore {
  private readonly versions = new Map<string, StoredPlugin>(); // `${name}@${version}`
  private readonly channels = new Map<string, Map<string, string>>(); // channel -> name -> version

  async upsertVersion(p: StoredPlugin): Promise<void> {
    const key = `${p.manifest.name}@${p.version}`;
    const prev = this.versions.get(key);
    if (prev) {
      // First-write-wins: identical coordinates are idempotent; only provenance
      // may be added/updated, and an undefined incoming never wipes a stored one.
      assertVersionImmutable(prev, p);
      this.versions.set(key, { ...prev, provenance: p.provenance ?? prev.provenance });
      return;
    }
    this.versions.set(key, p);
  }

  async setChannel(channel: string, name: string, version: string): Promise<void> {
    let m = this.channels.get(channel);
    if (!m) {
      m = new Map();
      this.channels.set(channel, m);
    }
    m.set(name, version);
  }

  async listLatest(channel = "stable"): Promise<StoredPlugin[]> {
    const m = this.channels.get(channel);
    if (!m) return [];
    const out: StoredPlugin[] = [];
    for (const [name, version] of m) {
      const v = this.versions.get(`${name}@${version}`);
      if (v) out.push(v);
    }
    return out.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  }
}
