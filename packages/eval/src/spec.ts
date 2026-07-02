// Spec-loading discipline for the per-plugin `evals/*.json` files. A MISSING spec
// is legal (the plugin simply ships no cases); a PRESENT-but-broken one must
// surface as a RED result naming the file — if a corrupted spec reads as "absent",
// it silently disables the very gate it feeds. Fail closed, never fail open.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkspacePlugin } from "@objectcore/registry-core";
import type { EvalResult } from "./types";

/** Sentinel for a spec file that exists but cannot be used. Returned rather than
 *  thrown so the run continues to completion: a throw would kill scripts/eval.ts
 *  before dist/eval-evidence.json is written, leaving stale evidence for the
 *  reflection loop instead of a fresh RED naming the broken file. */
export interface SpecLoadError {
  /** Plugin-relative path in display form (always "/"), e.g. "evals/activation.json". */
  file: string;
  error: string;
}

export function isSpecLoadError(x: unknown): x is SpecLoadError {
  return typeof x === "object" && x !== null && "error" in x && "file" in x;
}

/** Read + parse `<plugin>/evals/<file>`. Only ENOENT maps to null ("no spec");
 *  any other read error, a JSON parse error, or a `problem` reported by the shape
 *  check yields the SpecLoadError sentinel. The shape check runs here because a
 *  parseable-but-wrong-shape spec (e.g. `{"cases": {}}`) is as broken as
 *  unparseable JSON — it must not silently run zero cases. */
export async function loadSpec<T>(
  plugin: WorkspacePlugin,
  file: string,
  problem: (parsed: unknown) => string | null,
): Promise<T | null | SpecLoadError> {
  const rel = `evals/${file}`;
  let raw: string;
  try {
    raw = await readFile(join(plugin.dir, "evals", file), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    return { file: rel, error: (e as Error).message };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { file: rel, error: `invalid JSON — ${(e as Error).message}` };
  }
  const shape = problem(parsed);
  if (shape) return { file: rel, error: shape };
  return parsed as T;
}

/** Shape floor shared by activation + delegation specs: `cases` must be an array. */
export function casesShapeProblem(parsed: unknown): string | null {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return "spec must be an object with a `cases` array";
  }
  if (!Array.isArray((parsed as { cases?: unknown }).cases)) {
    return "`cases` must be an array";
  }
  return null;
}

/** The one red result a broken spec contributes to a suite. */
export function specUnreadableResult(
  suite: EvalResult["suite"],
  plugin: WorkspacePlugin,
  err: SpecLoadError,
): EvalResult {
  return {
    suite,
    plugin: plugin.manifest.name,
    name: `spec-unreadable:${err.file}`,
    level: "error",
    passed: false,
    detail: `${err.file} is present but unusable (${err.error}) — fix or delete it; a broken spec must not read as "no spec"`,
  };
}
