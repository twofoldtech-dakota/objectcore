// LibSqlCatalogStore — the Turso/libSQL adapter for the registry-core `CatalogStore`
// port. This is the only place the `@libsql/client` dependency lives, keeping
// registry-core dependency-free (the same reason it hand-rolls schema validation).

import { createClient, type Client } from "@libsql/client";
import type { CatalogStore, StoredPlugin, PluginManifest } from "@objectcore/registry-core";
import { SCHEMA_SQL } from "./schema";
import { assertVersionImmutable } from "./immutable";

export class LibSqlCatalogStore implements CatalogStore {
  constructor(private readonly client: Client) {}

  /** Construct from `DATABASE_URL` (+ optional `TURSO_AUTH_TOKEN`). Use
   *  `file:./local.db` or `:memory:` for local/dev, a `libsql://…` URL for Turso. */
  static fromEnv(): LibSqlCatalogStore {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("LibSqlCatalogStore: DATABASE_URL is not set");
    return new LibSqlCatalogStore(createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN }));
  }

  /** Apply the schema (idempotent). */
  async migrate(): Promise<void> {
    await this.client.executeMultiple(SCHEMA_SQL);
  }

  async listLatest(channel = "stable"): Promise<StoredPlugin[]> {
    const rs = await this.client.execute({
      sql: `SELECT pv.manifest, pv.rel_dir, pv.version, pv.sha, pv.ref, pv.repo_url, pv.provenance
            FROM channels c
            JOIN plugin_versions pv
              ON pv.plugin_name = c.plugin_name AND pv.version = c.version
            WHERE c.channel = ?
            ORDER BY c.plugin_name`,
      args: [channel],
    });
    return rs.rows.map((r) => ({
      manifest: JSON.parse(String(r.manifest)) as PluginManifest,
      relDir: String(r.rel_dir),
      version: String(r.version),
      sha: String(r.sha),
      ref: String(r.ref),
      repoUrl: String(r.repo_url),
      provenance: r.provenance == null ? undefined : JSON.parse(String(r.provenance)),
    }));
  }

  async upsertVersion(p: StoredPlugin): Promise<void> {
    const pluginsUpsert = {
      sql: `INSERT INTO plugins (name, rel_dir, updated_at)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(name) DO UPDATE SET rel_dir = excluded.rel_dir, updated_at = datetime('now')`,
      args: [p.manifest.name, p.relDir],
    };

    // First-write-wins (see assertVersionImmutable): an existing (name, version)
    // row is never rewritten — identical coordinates are idempotent and only
    // provenance moves; COALESCE keeps an undefined incoming from wiping it.
    const rs = await this.client.execute({
      sql: `SELECT manifest, rel_dir, sha, ref, repo_url FROM plugin_versions
            WHERE plugin_name = ? AND version = ?`,
      args: [p.manifest.name, p.version],
    });
    if (rs.rows.length) {
      const r = rs.rows[0]!;
      assertVersionImmutable(
        {
          manifest: JSON.parse(String(r.manifest)) as PluginManifest,
          relDir: String(r.rel_dir),
          version: p.version,
          sha: String(r.sha),
          ref: String(r.ref),
          repoUrl: String(r.repo_url),
        },
        p,
      );
      await this.client.batch(
        [
          pluginsUpsert,
          {
            sql: `UPDATE plugin_versions SET provenance = COALESCE(?, provenance)
                  WHERE plugin_name = ? AND version = ?`,
            args: [
              p.provenance === undefined ? null : JSON.stringify(p.provenance),
              p.manifest.name,
              p.version,
            ],
          },
        ],
        "write",
      );
      return;
    }

    await this.client.batch(
      [
        pluginsUpsert,
        {
          // Plain INSERT (no conflict clause): a lost race with a concurrent
          // publisher fails the primary key instead of clobbering the row.
          sql: `INSERT INTO plugin_versions
                  (plugin_name, version, manifest, rel_dir, sha, ref, repo_url, provenance)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            p.manifest.name,
            p.version,
            JSON.stringify(p.manifest),
            p.relDir,
            p.sha,
            p.ref,
            p.repoUrl,
            p.provenance === undefined ? null : JSON.stringify(p.provenance),
          ],
        },
      ],
      "write",
    );
  }

  async setChannel(channel: string, name: string, version: string): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO channels (channel, plugin_name, version)
            VALUES (?, ?, ?)
            ON CONFLICT(channel, plugin_name) DO UPDATE SET version = excluded.version`,
      args: [channel, name, version],
    });
  }
}
