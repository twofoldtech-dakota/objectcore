// Source adapters. The port is `TokenSource`: it loads a `DesignSystemSource` (named
// token sets + an optional resolver) for the pure `deriveDesignSystem` to consume —
// the analogue of registry-core's `CatalogSource`. `FileTokenSource` reads a directory
// of DTCG `*.tokens.json` files (each file = one named set) plus an optional
// `resolver.json` (the theming resolver + the themes to emit). Keeping I/O in the
// adapter leaves the engine pure and the input swappable (a future Tokens-Studio or
// Figma-export source is just another `TokenSource`).

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DesignSystemSource, ThemeSpec } from "./derive";
import type { Resolver } from "./theme";
import type { GateLevel } from "./roles";

export interface TokenSource {
  load(): Promise<DesignSystemSource>;
}

/** The on-disk shape of `resolver.json` (the resolver plus the themes to derive). */
interface ResolverFile extends Resolver {
  themes?: ThemeSpec[];
}

const SET_SUFFIX = ".tokens.json";

/** Reads `<dir>/*.tokens.json` (each → a named set) + optional `<dir>/resolver.json`. */
export class FileTokenSource implements TokenSource {
  constructor(private readonly dir: string) {}

  async load(): Promise<DesignSystemSource> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return { sets: {} };
    }

    // Label parse failures with the file path — the gate error must point at WHICH
    // file in WHICH system is broken, not surface a bare SyntaxError.
    const parse = (raw: string, file: string): unknown => {
      try {
        return JSON.parse(raw);
      } catch (e) {
        throw new Error(`${join(this.dir, file)}: ${(e as Error).message}`);
      }
    };

    const sets: Record<string, Record<string, unknown>> = {};
    for (const name of names.sort()) {
      if (!name.endsWith(SET_SUFFIX)) continue;
      const setName = name.slice(0, -SET_SUFFIX.length);
      const raw = await readFile(join(this.dir, name), "utf8");
      sets[setName] = parse(raw, name) as Record<string, unknown>;
    }

    let resolver: Resolver | undefined;
    let themes: ThemeSpec[] | undefined;
    if (names.includes("resolver.json")) {
      const parsed = parse(await readFile(join(this.dir, "resolver.json"), "utf8"), "resolver.json") as ResolverFile;
      resolver = { resolutionOrder: parsed.resolutionOrder, modifiers: parsed.modifiers };
      themes = parsed.themes;
    }

    return { sets, resolver, themes };
  }
}

// ── The system manifest (`design/<name>/system.json`, plan 014) ──────────────
//
// How a committed system declares WHAT it is gated to: the WCAG level its contract
// pairs must clear, whether the full role vocabulary is required (`coverage:
// "full"`) or only the pairs it actually speaks (`"presence"`), and — for seeded
// systems — which preset it came from. It is deliberately NOT `*.tokens.json`, so
// `FileTokenSource`'s set glob never picks it up.

/** `design/<name>/system.json`. */
export interface SystemManifest {
  gate: {
    /** The declared WCAG conformance level every contract text pair gates at. */
    level: GateLevel;
    /** `"full"` additionally requires every contract role (`checkContractCoverage`);
     *  absent ⇒ `"presence"` — gate only the pairs whose roles resolve. */
    coverage?: "presence" | "full";
  };
  /** Provenance for a seeded system (which preset/version/themes it came from). */
  seed?: { preset: string; version: string; themes: string[] };
}

const GATE_LEVELS = ["AA", "AAA"] as const;
const COVERAGES = ["presence", "full"] as const;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Strict shape check, reject-unknown like the manifest schema — a typo'd gate key
 *  must fail loudly, never silently gate at the (looser) defaults. */
function parseManifest(raw: unknown, path: string): SystemManifest {
  const bad = (msg: string): never => {
    throw new Error(`${path}: ${msg}`);
  };
  if (!isObj(raw)) bad("system.json must be a JSON object");
  const m = raw as Record<string, unknown>;
  for (const key of Object.keys(m)) if (key !== "gate" && key !== "seed") bad(`unknown key \`${key}\``);

  if (!isObj(m.gate)) bad("`gate` must be an object with a `level`");
  const gate = m.gate as Record<string, unknown>;
  for (const key of Object.keys(gate)) if (key !== "level" && key !== "coverage") bad(`unknown key \`gate.${key}\``);
  if (!GATE_LEVELS.includes(gate.level as GateLevel)) bad(`\`gate.level\` must be one of: ${GATE_LEVELS.join(", ")}`);
  if (gate.coverage !== undefined && !COVERAGES.includes(gate.coverage as never))
    bad(`\`gate.coverage\` must be one of: ${COVERAGES.join(", ")}`);

  let seed: SystemManifest["seed"];
  if (m.seed !== undefined) {
    if (!isObj(m.seed)) bad("`seed` must be an object");
    const s = m.seed as Record<string, unknown>;
    for (const key of Object.keys(s)) {
      if (key !== "preset" && key !== "version" && key !== "themes") bad(`unknown key \`seed.${key}\``);
    }
    if (typeof s.preset !== "string" || typeof s.version !== "string") bad("`seed.preset` and `seed.version` must be strings");
    if (!Array.isArray(s.themes) || !s.themes.every((t) => typeof t === "string")) bad("`seed.themes` must be an array of strings");
    seed = { preset: s.preset as string, version: s.version as string, themes: s.themes as string[] };
  }

  const out: SystemManifest = { gate: { level: gate.level as GateLevel } };
  if (gate.coverage !== undefined) out.gate.coverage = gate.coverage as "presence" | "full";
  if (seed) out.seed = seed;
  return out;
}

/** Load `<dir>/system.json`. A MISSING manifest is the pre-014 posture — defaults
 *  `{ gate: { level: "AA", coverage: "presence" } }` — so ungoverned systems keep
 *  gating exactly as before. A PRESENT-but-malformed one fails loudly with its path. */
export async function loadSystemManifest(dir: string): Promise<SystemManifest> {
  const path = join(dir, "system.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT") return { gate: { level: "AA", coverage: "presence" } };
    throw e;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${path}: ${(e as Error).message}`);
  }
  return parseManifest(parsed, path);
}
