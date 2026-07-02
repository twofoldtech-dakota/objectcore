// `bun run registry:smoke [--url <base>]` — post-publish/post-deploy smoke check
// against the LIVE registry: the missing read-back between `registry:publish`'s POST
// and the bytes consumers actually see (OIDC write -> DB read-back -> shaPin
// re-derivation all sit in between). Read-only; never touches the seam's contract.
//
// Checks:
//   1. GET /readyz            -> 200 { ready: true }  (the DB-touching probe)
//   2. GET /v1/marketplace.json -> parses, `name` matches objectcore.config.json, and
//      every entry's source is a sha-pinned git-subdir (proves the pins() resolver
//      path ran — a bare-path entry only resolves under Git distribution).
//   3. When dist/marketplace.pinned.json exists locally: every {name, version} pair
//      in the pinned artifact appears in the served catalog. A SUPERSET check, not
//      set-equality — plugin_versions is append-only, so a plugin removed from the
//      repo legitimately keeps being served.
//
// Base URL: --url arg > OBJECTCORE_REGISTRY_URL > objectcore.config.json's
// registryUrl origin. Skips green when none resolves (the registry:publish posture).
// Fetches retry briefly to absorb a Fly cold start (min_machines_running=0) and the
// RegistryDbSource ~5s row cache right after a publish.
//
// Deliberately NOT part of `bun run check` — the gate must stay runnable offline.

import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";

const root = join(import.meta.dir, "..");
const cfg = JSON.parse(readFileSync(join(root, "objectcore.config.json"), "utf8")) as {
  name: string;
  registryUrl?: string;
};

function resolveBase(): string | null {
  const argIdx = process.argv.indexOf("--url");
  if (argIdx !== -1 && process.argv[argIdx + 1]) return process.argv[argIdx + 1]!;
  if (process.env.OBJECTCORE_REGISTRY_URL) return process.env.OBJECTCORE_REGISTRY_URL;
  if (cfg.registryUrl) return new URL(cfg.registryUrl).origin;
  return null;
}

const base = resolveBase()?.replace(/\/+$/, "");
if (!base) {
  console.log("• registry:smoke skipped — no registry URL (pass --url, set OBJECTCORE_REGISTRY_URL, or add registryUrl to objectcore.config.json).");
  process.exit(0);
}

const ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;
const failures: string[] = [];

/** GET with a short retry — absorbs cold starts and the post-publish row cache. */
async function getJson(path: string): Promise<{ status: number; body: unknown }> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${base}${path}`);
      if (res.ok) return { status: res.status, body: await res.json() };
      lastErr = new Error(`${res.status} ${await res.text().catch(() => "")}`.trim());
    } catch (e) {
      lastErr = e;
    }
    if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  }
  throw new Error(`GET ${path} failed after ${ATTEMPTS} attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

console.log(`registry:smoke -> ${base}`);

// 1. Readiness: the DB-touching probe, not the shallow /healthz.
try {
  const { body } = await getJson("/readyz");
  if ((body as { ready?: unknown }).ready === true) {
    console.log("✓ /readyz is ready");
  } else {
    failures.push(`/readyz responded but not ready: ${JSON.stringify(body)}`);
  }
} catch (e) {
  failures.push(e instanceof Error ? e.message : String(e));
}

// 2. The seam: valid catalog, right marketplace, every entry sha-pinned.
interface ServedEntry {
  name?: string;
  version?: string;
  source?: unknown;
}
let served: ServedEntry[] = [];
const beforeSeam = failures.length;
try {
  const { body } = await getJson("/v1/marketplace.json");
  const catalog = body as { name?: string; plugins?: ServedEntry[] };
  if (catalog.name !== cfg.name) {
    failures.push(`catalog name "${catalog.name}" != config name "${cfg.name}"`);
  }
  served = Array.isArray(catalog.plugins) ? catalog.plugins : [];
  if (!served.length) failures.push("served catalog has no plugins");
  for (const p of served) {
    const s = p.source as { source?: string; sha?: string } | string | undefined;
    if (typeof s !== "object" || s === null || s.source !== "git-subdir" || !/^[0-9a-f]{40}$/i.test(s.sha ?? "")) {
      failures.push(`entry "${p.name}" is not a sha-pinned git-subdir source: ${JSON.stringify(p.source)}`);
    }
  }
  if (failures.length === beforeSeam) console.log(`✓ /v1/marketplace.json serves ${served.length} sha-pinned plugin(s) for "${catalog.name}"`);
} catch (e) {
  failures.push(e instanceof Error ? e.message : String(e));
}

// 3. Pinned-artifact read-back (only when the local artifact exists — a pure redeploy
//    has no dist/, so steps 1-2 are the whole check there).
const pinnedPath = join(root, "dist", "marketplace.pinned.json");
if (existsSync(pinnedPath) && served.length) {
  const pinned = JSON.parse(readFileSync(pinnedPath, "utf8")) as { plugins?: ServedEntry[] };
  const servedSet = new Set(served.map((p) => `${p.name}@${p.version}`));
  const missing = (pinned.plugins ?? []).filter((p) => !servedSet.has(`${p.name}@${p.version}`));
  if (missing.length) {
    failures.push(
      `pinned artifact entries not served: ${missing.map((p) => `${p.name}@${p.version}`).join(", ")}`,
    );
  } else {
    console.log(`✓ all ${pinned.plugins?.length ?? 0} pinned {name, version} pair(s) are served`);
  }
} else if (!existsSync(pinnedPath)) {
  console.log("• no local dist/marketplace.pinned.json — skipping the read-back diff (expected on a pure redeploy)");
}

if (failures.length) {
  for (const f of failures) console.error(`✗ ${f}`);
  console.error(`\nregistry:smoke -> ${failures.length} failure(s) (${base})`);
  process.exit(1);
}
console.log(`\nregistry:smoke -> green (${base})`);
