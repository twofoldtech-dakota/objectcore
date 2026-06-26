// Telemetry ingestion — the write-side analogue of `searchCatalog`. The port is
// `EventSink`; the shaping/validation is a pure, dependency-free function (no
// `Date.now` — the timestamp is server-assigned at the store edge, the same posture
// as deriveCatalog / searchCatalog / validateSchema). Purely additive: it never
// touches the catalog seam (`/v1/marketplace.json` stays frozen).

/** The allowlisted event kinds. Unknown types are rejected, not silently dropped —
 *  the same strict stance as schema.ts (no silent caps). */
export const EVENT_TYPES = ["install", "uninstall", "activate", "delegate", "search", "view"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** A telemetry event as accepted by `POST /v1/events`. `meta` is a small bag of
 *  primitive extras; the server-assigned timestamp lives on {@link StoredEvent}, not
 *  here — clients never set time. */
export interface TelemetryEvent {
  type: EventType;
  /** The plugin the event is about (kebab-case). Optional: a bare search has none. */
  plugin?: string;
  /** The channel the event came from (e.g. "stable"/"canary"). Optional. */
  channel?: string;
  /** A small bag of extra fields. Bounded in count + size; values are primitives. */
  meta?: Record<string, string | number | boolean>;
}

/** A persisted event: the accepted event plus the store's ingestion timestamp. */
export interface StoredEvent extends TelemetryEvent {
  /** Server-assigned ingestion timestamp (ISO-8601 / SQLite datetime). */
  at: string;
}

/** The telemetry write port. Concrete adapters (libSQL/Turso, in-memory) live in
 *  @objectcore/registry-db so this core stays dependency-free. `record` is the
 *  operated path; `recent`/`count` back tests and a future authenticated stats route. */
export interface EventSink {
  record(event: TelemetryEvent): Promise<void>;
  recent(limit?: number): Promise<StoredEvent[]>;
  count(): Promise<number>;
}

export type EventParseResult =
  | { ok: true; event: TelemetryEvent }
  | { ok: false; error: string };

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ALLOWED_FIELDS = new Set(["type", "plugin", "channel", "meta"]);
const MAX_META_KEYS = 16;
const MAX_STRING_LEN = 512;

/** Strict, pure validation/shaping of an untrusted POST body into a TelemetryEvent —
 *  rejecting unknown top-level fields, unknown event types, non-kebab plugin/channel,
 *  and oversized / non-primitive meta. Mirrors schema.ts's reject-unknown-fields
 *  stance. Never throws; returns a tagged result the route maps to 400. */
export function parseEvent(input: unknown): EventParseResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "event must be a JSON object" };
  }
  const o = input as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!ALLOWED_FIELDS.has(k)) return { ok: false, error: `unknown field: ${k}` };
  }

  if (typeof o.type !== "string" || !(EVENT_TYPES as readonly string[]).includes(o.type)) {
    return { ok: false, error: `type must be one of: ${EVENT_TYPES.join(", ")}` };
  }
  const event: TelemetryEvent = { type: o.type as EventType };

  if (o.plugin !== undefined) {
    if (typeof o.plugin !== "string" || !KEBAB.test(o.plugin)) {
      return { ok: false, error: "plugin must be a kebab-case string" };
    }
    event.plugin = o.plugin;
  }
  if (o.channel !== undefined) {
    if (typeof o.channel !== "string" || !KEBAB.test(o.channel)) {
      return { ok: false, error: "channel must be a kebab-case string" };
    }
    event.channel = o.channel;
  }

  if (o.meta !== undefined) {
    if (typeof o.meta !== "object" || o.meta === null || Array.isArray(o.meta)) {
      return { ok: false, error: "meta must be an object" };
    }
    const meta = o.meta as Record<string, unknown>;
    const keys = Object.keys(meta);
    if (keys.length > MAX_META_KEYS) {
      return { ok: false, error: `meta has too many keys (max ${MAX_META_KEYS})` };
    }
    const out: Record<string, string | number | boolean> = {};
    for (const k of keys) {
      const v = meta[k];
      const t = typeof v;
      if (t !== "string" && t !== "number" && t !== "boolean") {
        return { ok: false, error: `meta.${k} must be a string, number, or boolean` };
      }
      if (t === "string" && (v as string).length > MAX_STRING_LEN) {
        return { ok: false, error: `meta.${k} exceeds ${MAX_STRING_LEN} chars` };
      }
      out[k] = v as string | number | boolean;
    }
    event.meta = out;
  }

  return { ok: true, event };
}
