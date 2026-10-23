# syntax=docker/dockerfile:1
# Build from the repository root:
#   docker buildx build --platform linux/amd64 -f apps/backend/Dockerfile -t ghcr.io/captain-slow/house-solar-backend:<tag> .
#
# Runtime contents (WORKDIR /app), exactly: dist/, pruned hoisted production node_modules/
# (including prisma, @prisma/* and the schema-engine binary downloaded during `npm ci`, so the
# migrate service needs no egress), prisma/ (schema + migrations), prisma.config.ts,
# src/config/database-url.ts, package.json, plus the OS package `openssl` (the schema engine
# links libssl). `prisma migrate deploy` needs nothing else (V19).
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5

# ---- full install + build ---------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/backend/package.json apps/backend/package.json
# Prisma's schema engine links libssl, which the slim image lacks.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
# Install scripts approved in the root package.json `allowScripts` (prisma engines) run here.
RUN npm ci -w apps/backend
COPY apps/backend apps/backend
WORKDIR /repo/apps/backend
# prisma.config.ts needs a URL to load; it is never connected to at build time.
ENV DATABASE_URL=postgresql://build@localhost:5432/build
RUN npx prisma generate && npx nest build

# ---- production-only dependencies ---------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /repo
# Must be present when `npm ci` runs: Prisma picks the schema-engine binary for the detected OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
RUN npm ci -w apps/backend --omit=dev \
 && rm -f node_modules/backend \
 && npm cache clean --force

# ---- runtime ------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    TZ=UTC \
    HOME=/tmp \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=build /repo/apps/backend/dist ./dist
COPY --from=build /repo/apps/backend/prisma ./prisma
COPY --from=build /repo/apps/backend/prisma.config.ts ./prisma.config.ts
COPY --from=build /repo/apps/backend/src/config/database-url.ts ./src/config/database-url.ts
COPY --from=build /repo/apps/backend/package.json ./package.json
USER 568:568
CMD ["node", "dist/main.js"]
