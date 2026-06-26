// Registry DB schema (Stage 3). SQLite/libSQL DDL applied by `migrate()`.
//
// The DB stores RAW manifests + pin coordinates, never finished catalog entries —
// `deriveCatalog` still shapes entries at read time, preserving the single
// derivation path. `plugin_versions` is append-only (the unit Stage 2 publishes);
// `channels` points each plugin to its current published version per channel.

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS plugins (
  name       TEXT PRIMARY KEY,
  rel_dir    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plugin_versions (
  plugin_name  TEXT NOT NULL REFERENCES plugins(name),
  version      TEXT NOT NULL,
  manifest     TEXT NOT NULL,                 -- the full PluginManifest, JSON
  rel_dir      TEXT NOT NULL,
  sha          TEXT NOT NULL,                 -- release commit sha (git-subdir pin)
  ref          TEXT NOT NULL,                 -- releaseTag(name, version)
  repo_url     TEXT NOT NULL,
  provenance   TEXT,                          -- attestation reference, JSON, nullable
  published_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (plugin_name, version)
);

CREATE TABLE IF NOT EXISTS channels (
  channel     TEXT NOT NULL,
  plugin_name TEXT NOT NULL REFERENCES plugins(name),
  version     TEXT NOT NULL,
  PRIMARY KEY (channel, plugin_name)
);
`;

// Telemetry schema (the `/v1/events` write path). Kept a SEPARATE constant + a
// SEPARATE store from the catalog so the two concerns stay independent — events are
// unrelated to derivation. Append-only; the server stamps `at` via SQLite. Both
// migrations are idempotent (CREATE ... IF NOT EXISTS), applied on boot in prod.ts.
export const EVENTS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  type    TEXT NOT NULL,
  plugin  TEXT,
  channel TEXT,
  meta    TEXT,                              -- small JSON bag, nullable
  at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS events_plugin_idx ON events(plugin);
CREATE INDEX IF NOT EXISTS events_type_idx ON events(type);
`;
