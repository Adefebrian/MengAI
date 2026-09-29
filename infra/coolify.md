# Deploying crew to Coolify

Target: deploy.jalgroup.id. Two Coolify applications, one per Dockerfile in this
directory. Self-hosted Postgres and the shared Redis instance are provisioned
separately per `jal-standards`, this repo does not manage them in production.

## apps/api

1. New Resource -> Application -> Dockerfile.
2. Repository: this monorepo, branch to track.
3. Dockerfile path: `infra/Dockerfile.api`, build context: repo root.
4. Port: `3001`.
5. Environment variables (Coolify injects these at runtime, never baked into
   the image): `DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, `S3_REGION`,
   `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `OPENAI_API_KEY`,
   `CORS_ORIGINS`, `PORT`.
6. Health check path: `/health`.

## apps/web

1. New Resource -> Application -> Dockerfile.
2. Dockerfile path: `infra/Dockerfile.web`, build context: repo root.
3. Port: `3000`.
4. Environment variables: `WEB_PORT` (optional, defaults to 3000).
5. No secrets belong in this app, it only serves the static SPA bundle.

## Rollback

Tag every built image (`crew-api:<sha>`, `crew-web:<sha>`) so a
rollback in Coolify is a one-click redeploy of the previous tag, never a
rebuild from a reverted commit under time pressure.

## CI/CD

`.github/workflows/ci.yml` runs on the self-hosted `gh` runner and must pass
(`turbo typecheck lint test build`) before Coolify's webhook deploy trigger
fires on the tracked branch.
