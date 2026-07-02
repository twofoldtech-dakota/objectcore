# ObjectCore registry backend (Stage 3). Same Bun + Hono app as the dev loop;
# packages/registry-server/src/prod.ts swaps the CatalogSource to RegistryDbSource
# (Turso/libSQL) and serves the SHA-pinned catalog at /v1/marketplace.json.
# Pinned to the exact Bun the repo develops against (.bun-version) — a floating
# major tag can change the runtime under the deploy.
FROM oven/bun:1.3.6
WORKDIR /app

# Workspace install. (Copying everything is fine for a small repo; the registry has
# no build step — Bun runs the TypeScript entry directly.)
COPY . .
RUN bun install --frozen-lockfile

# db = serve from Turso (set DATABASE_URL + TURSO_AUTH_TOKEN as Fly secrets).
# file = break-glass: serve a baked dist/marketplace.pinned.json verbatim.
#   .dockerignore un-ignores dist/marketplace.pinned.json so a baked catalog CAN ship —
#   but dist/ is also gitignored, so materialize the file in the build context before
#   `flyctl deploy` (gh run download the `marketplace-pinned` artifact, or run
#   `bun run release:publish` locally), or point OBJECTCORE_PINNED at a volume path.
ENV OBJECTCORE_SOURCE=db
ENV PORT=8080
EXPOSE 8080

CMD ["bun", "run", "packages/registry-server/src/prod.ts"]
