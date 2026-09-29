# syntax=docker/dockerfile:1.7
# MengAI server image: one image builds the web SPA and runs the API, which
# serves the SPA from WEB_DIR. Build from the repo root:
#   docker build -f infra/Dockerfile -t mengai:latest .
# Base image pinned to the Bun version in package.json (packageManager).
ARG BUN_IMAGE=oven/bun:1.3.14-slim

# ---- deps: full install (dev deps included) for the web build
FROM ${BUN_IMAGE} AS deps
WORKDIR /repo
COPY package.json bun.lock bunfig.toml ./
# --frozen-lockfile checks every workspace, so every manifest must be present
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY packages/cats/package.json packages/cats/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN bun install --frozen-lockfile --ignore-scripts

# ---- prod-deps: runtime dependencies only
FROM deps AS prod-deps
RUN rm -rf node_modules && bun install --frozen-lockfile --production --ignore-scripts

# ---- build: bundle the SPA with Bun.build
FROM deps AS build
COPY tsconfig.base.json turbo.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN cd apps/web && bun run build.ts

# ---- runtime
FROM ${BUN_IMAGE} AS runtime
WORKDIR /repo
ENV NODE_ENV=production \
    MENGAI_MODE=server \
    HOST=0.0.0.0 \
    PORT=3001 \
    DATA_DIR=/data \
    WEB_DIR=/repo/web \
    BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY package.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/config ./packages/config
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
COPY apps/api/src ./apps/api/src
COPY migrations ./migrations
COPY --from=build /repo/apps/web/dist ./web
RUN mkdir -p /data && chown bun:bun /data \
    && rm -rf apps/api/src/testing \
    && find apps/api/src -name '*.test.ts' -delete
USER bun
EXPOSE 3001
VOLUME ["/data"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["bun", "apps/api/src/index.ts"]
