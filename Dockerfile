# ObjectCore registry backend (Stage 3). Same Bun + Hono app as the dev loop;
# packages/registry-server/src/prod.ts swaps the CatalogSource to RegistryDbSource
# (Turso/libSQL) and serves the SHA-pinned catalog at /v1/marketplace.json.
FROM oven/bun:1
WORKDIR /app

# Workspace install. (Copying everything is fine for a small repo; the registry has
# no build step — Bun runs the TypeScript entry directly.)
COPY . .
RUN bun install --frozen-lockfile

# db = serve from Turso (set DATABASE_URL + TURSO_AUTH_TOKEN as Fly secrets).
# file = break-glass: serve a baked dist/marketplace.pinned.json verbatim.
ENV OBJECTCORE_SOURCE=db
ENV PORT=8080
EXPOSE 8080

CMD ["bun", "run", "packages/registry-server/src/prod.ts"]
