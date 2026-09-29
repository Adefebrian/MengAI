# MengAI

MengAI is an AI agent orchestration product where the agents are living
cats. Give the crew a goal; the lead cat plans the work, engineers,
designers, reviewers, QA, security and research cats build it, hand tasks
to each other, review each other, and report back. You watch every step
live, and the whole thing runs on your own model keys.

It ships as a public website, a web app you can self-host, and a native
macOS app, all from one codebase.

Built by Adefebrian. Open source under the Apache License 2.0 (see
`LICENSE` and `NOTICE`).

## What it does

- Multi-agent orchestration: a task graph with dependencies, handoffs,
  review rounds, budgets, pause, resume, stop, and a kill switch.
- Bring your own keys: OpenAI, Anthropic, DeepSeek, Xiaomi MiMo, Gemini,
  OpenRouter, Groq, Mistral, xAI, Moonshot, Z.ai, Qwen, MiniMax, Together,
  Fireworks, Ollama, LM Studio, AgentRouter, or any OpenAI or Anthropic
  compatible endpoint. Keys live in the macOS keychain (app) or an
  encrypted vault (server) and are never returned, logged or sent to a
  model.
- Token efficiency: stable-first prompt layout for vendor prompt caching,
  role-scoped tool sets, per-call budgets, rolling summaries, tool output
  truncation, and a built-in benchmark against the legacy behaviour.
- Self-learning memory: lessons scored by outcome, promoted across
  projects, and reusable skills.
- JEV decision layer for routing, model tier, loop exit and severity
  calls, with a deterministic fallback stamped `UNVERIFIED BY JEV`.
- Asset generation (images and video) through your configured providers.
- Defensive security scanning of your own codebase: dependency audit,
  credential leak detection, configuration review.
- Local computer automation with per-capability permission, confirmation
  for anything destructive or sensitive, a hash-chained audit log and an
  always-visible kill switch (see `docs/automation-safety.md`).

## Repository layout

```
apps/api        Hono API on Bun (modular monolith, one module per domain)
apps/web        React SPA built with Bun.build: landing at / and the app at /app
apps/desktop    Tauri 2 shell for macOS; runs the API as a compiled sidecar
packages/shared wire contract: enums, DTOs, events, routes, provider presets
packages/ui     JAL Core design system and product components
packages/cats   the cat character system (SVG rig, motion, reduced motion)
packages/config env schema
services/hands  native macOS helper for local automation (Rust, stdio JSON-RPC)
migrations/     SQLite (app) and Postgres (server) schemas
infra/          Dockerfile, docker-compose, deploy guide
docs/           architecture, design, reports, ADRs
```

Architecture: `docs/architecture.md`.

## Quick start (development)

Requirements: Bun 1.3.14 (`bun --version`). Rust stable only for the
desktop shell and the native helper.

```bash
bun install
cp .env.example .env
bun run dev
```

`bun run dev` starts the API in local mode on 127.0.0.1 and serves the
web app. Open the printed URL, add a provider key under Providers, pick a
project folder, and start a run.

Checks:

```bash
bun test
bunx turbo typecheck build
bun run check:boundaries
```

## Self-hosting the web app

See `infra/deploy.md`. One container serves the API and the SPA; Postgres
and Redis run beside it. Server mode uses a single owner account created
on first launch with a setup code from the environment.

## macOS app

See `apps/desktop/README.md` for building, signing and notarizing.

## Security model

- Every API request is validated; strict security headers, an origin
  allowlist, CSRF checks, rate limits and body caps are on by default.
- Agent shell commands run in a jailed sandbox scoped to the project
  workspace with a scrubbed environment and hard timeouts.
- Secrets are redacted from logs, events, database rows and prompts.
- Report a vulnerability privately to the maintainer before disclosure.

## Credits

Built by Adefebrian. MengAI began as a rewrite of the catcomp
("Briworkers") project; see `NOTICE` for attribution.
