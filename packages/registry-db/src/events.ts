// EventSink adapters for the telemetry write path. `LibSqlEventStore` is the
// Turso/libSQL adapter (the only place the `@libsql/client` dep lives, keeping
// registry-core dependency-free); `InMemoryEventStore` is the dependency-free
// adapter for tests / no-DB local dev. Same `EventSink` contract, so the server
// wires either behind `POST /v1/events`.

import { createClient, type Client, type Row } from "@libsql/client";
import type { EventSink, EventType, StoredEvent, TelemetryEvent } from "@objectcore/registry-core";
import { EVENTS_SCHEMA_SQL } from "./schema";

function rowToEvent(r: Row): StoredEvent {
  const e: StoredEvent = { type: String(r.type) as EventType, at: String(r.at) };
  if (r.plugin != null) e.plugin = String(r.plugin);
  if (r.channel != null) e.channel = String(r.channel);
  if (r.meta != null) e.meta = JSON.parse(String(r.meta));
  return e;
}

export class LibSqlEventStore implements EventSink {
  constructor(private readonly client: Client) {}

  /** Construct from `DATABASE_URL` (+ optional `TURSO_AUTH_TOKEN`) — same env as
   *  LibSqlCatalogStore (shares the DB; a separate table). */
  static fromEnv(): LibSqlEventStore {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("LibSqlEventStore: DATABASE_URL is not set");
    return new LibSqlEventStore(createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN }));
  }

  /** Apply the events schema (idempotent). */
  async migrate(): Promise<void> {
    await this.client.executeMultiple(EVENTS_SCHEMA_SQL);
  }

  async record(e: TelemetryEvent): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO events (type, plugin, channel, meta) VALUES (?, ?, ?, ?)`,
      args: [e.type, e.plugin ?? null, e.channel ?? null, e.meta ? JSON.stringify(e.meta) : null],
    });
  }

  async recent(limit = 100): Promise<StoredEvent[]> {
    const rs = await this.client.execute({
      sql: `SELECT type, plugin, channel, meta, at FROM events ORDER BY id DESC LIMIT ?`,
      args: [limit],
    });
    return rs.rows.map(rowToEvent);
  }

  async count(): Promise<number> {
    const rs = await this.client.execute(`SELECT COUNT(*) AS n FROM events`);
    return Number(rs.rows[0]?.n ?? 0);
  }
}

/** In-memory `EventSink` for tests / local dev (no DB). The clock is injectable so
 *  tests get a deterministic `at` (the store is an adapter, not the pure core, so a
 *  real `Date` default is fine here — the same reason LibSql uses `datetime('now')`). */
export class InMemoryEventStore implements EventSink {
  private readonly events: StoredEvent[] = [];
  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  async record(e: TelemetryEvent): Promise<void> {
    this.events.push({ ...e, at: this.now() });
  }

  async recent(limit = 100): Promise<StoredEvent[]> {
    return this.events.slice(-limit).reverse(); // most-recent first, like the SQL ORDER BY id DESC
  }

  async count(): Promise<number> {
    return this.events.length;
  }
}
