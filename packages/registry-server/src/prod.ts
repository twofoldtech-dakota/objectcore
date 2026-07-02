// Prod entry for the ObjectCore registry backend (Stage 3). Same createApp + the same
// deriveCatalog seam as the dev loop; the differences are the CatalogSource and that
// the served catalog is SHA-pinned (git-subdir) — required for URL distribution, since
// bare relative-path sources only resolve under Git (AGENTS.md).
//
//   OBJECTCORE_SOURCE=db    (default) — serve from Turso/libSQL via RegistryDbSource;
//                                       pins (shaPin/repoUrl) come from the same rows.
//   OBJECTCORE_SOURCE=file             — break-glass: serve a baked
//                                       dist/marketplace.pinned.json verbatim
//                                       (serving, not a second derivation).
//
// Break-glass runbook (OBJECTCORE_SOURCE=file): dist/ is gitignored and the deploy
// builds from a fresh checkout, so the pinned file must be materialized in the build
// context BEFORE `flyctl deploy` — `gh run download` the `marketplace-pinned` artifact
// release.yml uploads, or run `bun run release:publish` locally — or point
// OBJECTCORE_PINNED at a path that exists in the image/volume. (.dockerignore
// deliberately un-ignores dist/marketplace.pinned.json so a baked catalog CAN ship.)
//
// Publish env (POST /v1/plugins — inert until OBJECTCORE_OIDC_AUDIENCE is set):
//   OBJECTCORE_OIDC_AUDIENCE   arms the route; the expected token `aud`.
//   OBJECTCORE_OIDC_ISSUER     token issuer (default: GitHub Actions).
//   OBJECTCORE_PUBLISH_REPOS   comma-separated owner/repo allowlist.
//   OBJECTCORE_PUBLISH_REFS    comma-separated allowed git refs (default
//                              refs/heads/main — the live release pipeline publishes
//                              only from main; any branch of an allowlisted repo can
//                              mint a token, so the ref restriction is the release gate).

import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { Hono } from "hono";
import { GitHubOidcVerifier, RegistryDbSource, type DeriveOpts } from "@objectcore/registry-core";
import { LibSqlCatalogStore, LibSqlEventStore } from "@objectcore/registry-db";
import { createApp } from "./app";
import { fileApp } from "./file-app";

const root = join(import.meta.dir, "..", "..", "..");
const cfg = JSON.parse(readFileSync(join(root, "objectcore.config.json"), "utf8"));
const base = { name: cfg.name, owner: cfg.owner, pluginRoot: cfg.pluginRoot, schema: cfg.schema };

const mode = process.env.OBJECTCORE_SOURCE ?? "db";
const channel = process.env.OBJECTCORE_CHANNEL ?? "stable";
const port = Number(process.env.PORT ?? 8080);

function bootFileApp(): Hono {
  const pinnedPath = process.env.OBJECTCORE_PINNED ?? join(root, "dist", "marketplace.pinned.json");
  // read + parse at boot: a missing/corrupt baked file fails the machine here,
  // never mid-serve — booted == ready (fileApp's /readyz).
  const pinned = JSON.parse(readFileSync(pinnedPath, "utf8"));
  console.log(`ObjectCore registry (prod/file) -> :${port} [${pinnedPath}]`);
  return fileApp(pinned);
}

async function dbApp(): Promise<Hono> {
  const store = LibSqlCatalogStore.fromEnv();
  await store.migrate(); // idempotent: a fresh Turso DB gets its schema before first serve
  const events = LibSqlEventStore.fromEnv(); // same DB, separate events table
  await events.migrate();
  const allowed = new Set(
    (process.env.OBJECTCORE_CHANNELS ?? "stable,canary").split(",").map((s) => s.trim()).filter(Boolean),
  );
  // cache rows ~5s so listPlugins() + pins() in one request hit the DB once.
  // Memoized per channel: a fresh source per request would start its cache cold
  // every time, making every channel hit a guaranteed DB query. The allowlist check
  // before sourceFor keeps the map bounded.
  const memo = new Map<string, { source: RegistryDbSource; derive: () => Promise<DeriveOpts> }>();
  const sourceFor = (ch: string) => {
    let entry = memo.get(ch);
    if (!entry) {
      const src = new RegistryDbSource(store, ch, 5000);
      entry = { source: src, derive: async () => ({ ...base, ...(await src.pins()) }) };
      memo.set(ch, entry);
    }
    return entry;
  };
  const stable = sourceFor(channel);

  // Self-service publish — inert until armed. Enabled only when an OIDC audience is
  // configured; otherwise POST /v1/plugins is absent (the release-CI git path still
  // ingests via registry:ingest regardless). issuer defaults to GitHub Actions.
  const audience = process.env.OBJECTCORE_OIDC_AUDIENCE;
  const issuer = process.env.OBJECTCORE_OIDC_ISSUER ?? "https://token.actions.githubusercontent.com";
  const publish = audience
    ? {
        verifier: new GitHubOidcVerifier(issuer),
        policy: {
          issuer,
          audience,
          allowedRepositories: (process.env.OBJECTCORE_PUBLISH_REPOS ?? "")
            .split(",").map((s) => s.trim()).filter(Boolean),
          // Default to main: any branch of an allowlisted repo can mint a token, so
          // without a ref restriction a PR-branch workflow bypasses the release gate.
          allowedRefs: (process.env.OBJECTCORE_PUBLISH_REFS ?? "refs/heads/main")
            .split(",").map((s) => s.trim()).filter(Boolean),
        },
        store,
      }
    : undefined;

  console.log(
    `ObjectCore registry (prod/db) -> :${port} [channel=${channel}, channels=${[...allowed].join(",")}, publish=${publish ? "on" : "off"}]`,
  );
  return createApp({
    ...stable,
    events,
    eventsToken: process.env.OBJECTCORE_EVENTS_TOKEN, // unset -> open ingestion
    publish,
    ready: async () => {
      await store.listLatest(channel); // throws if the DB is unreachable / schema missing
      return true;
    },
    channels: (ch) => (allowed.has(ch) ? sourceFor(ch) : undefined),
  });
}

const app = mode === "file" ? bootFileApp() : await dbApp();
export default { port, fetch: app.fetch };
