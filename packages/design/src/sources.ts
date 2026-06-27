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

    const sets: Record<string, Record<string, unknown>> = {};
    for (const name of names.sort()) {
      if (!name.endsWith(SET_SUFFIX)) continue;
      const setName = name.slice(0, -SET_SUFFIX.length);
      const raw = await readFile(join(this.dir, name), "utf8");
      sets[setName] = JSON.parse(raw) as Record<string, unknown>;
    }

    let resolver: Resolver | undefined;
    let themes: ThemeSpec[] | undefined;
    if (names.includes("resolver.json")) {
      const parsed = JSON.parse(await readFile(join(this.dir, "resolver.json"), "utf8")) as ResolverFile;
      resolver = { resolutionOrder: parsed.resolutionOrder, modifiers: parsed.modifiers };
      themes = parsed.themes;
    }

    return { sets, resolver, themes };
  }
}
