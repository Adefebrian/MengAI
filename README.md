# crew

A Bun-only monorepo: Hono API, a React SPA bundled with `Bun.build()`, and shared
UI/config packages. No Vite, no Next.js, no webpack.

## Layout

```
apps/web/     React + TypeScript SPA, built with Bun.build(), served by Hono static server.
apps/api/     Hono on Bun: Postgres + Redis + S3 clients, security middleware, gpt-4o-mini client.
packages/ui/  Shared React components: bento primitives, tokens, icon wrapper, gradient presets.
packages/config/ shared env schema.
infra/        Per-app Dockerfile (multi-stage, slim), docker-compose for local Postgres + Redis.
.github/workflows/ci.yml
.jal/memory/
```

## Getting started

```bash
bun install
cp .env.example .env   # fill in real values, never commit .env
bun run build
bun test
bun run dev
```

## Scripts

- `bun run build` - `turbo run build` across all workspaces.
- `bun test` - runs every `*.test.ts`/`*.test.tsx` in the workspace (happy-dom for
  apps/web, direct `app.request()` for apps/api, no live services required).
- `bun run typecheck` - `tsc --noEmit` per workspace via turbo.
- `bun run lint` - lint per workspace via turbo.
- `bun run dev` - watches apps/web (rebuild on save) and apps/api (restart on save)
  in parallel. No Vite dev server, no HMR: a full rebuild on each save, by design,
  so dev and prod share the exact same build path.

## Stack

Bun runtime and package manager, Hono for HTTP, React for the SPA, TypeScript
everywhere, Docker for local parity, Redis for rate limiting and caching,
Turborepo for task orchestration. Vite, Next.js, webpack, and Create React App
are not used anywhere in this repository.

## Deploy

Build the images in `infra/Dockerfile.api` and `infra/Dockerfile.web`, then deploy
through Coolify. See `infra/coolify.md` for the exact steps.
