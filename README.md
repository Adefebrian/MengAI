# MengAI

> Required Notice: Built by Adefebrian (https://adefebrian.com). Source available under the PolyForm Noncommercial License 1.0.0. Commercial use needs written permission: adefebrianpro@gmail.com

MengAI is an autonomous AI agent company where every agent is a living cat.
Give the crew a goal: Oyen, the ginger CEO cat, plans the work, hires the
roles it needs, holds meetings, approves requests and ships. Every cat has
its own desk, walks the office, reviews the others and learns from every
run. You watch every step live, see what is in each cat's head, and follow
the work on a delivery style tracker from goal to shipped.

Everything runs on your own Mac with your own model keys. The website is
only the interface: it has no accounts and stores nothing.

**Download the beta for Mac:** https://github.com/Adefebrian/MengAI/releases/tag/v0.1.0-beta

## What it does

- A living office: desks, meetings, handoffs, reviews, hiring and letting
  go, with scenario unique motion for each kind of work.
- Company brain: loop engineering, autonomous prompt engineering judged by
  JEV, dynamic roles, unlimited agents and sub agents, crew wide skills.
- Bring your own key for any provider and any model: OpenAI, Anthropic,
  DeepSeek, Xiaomi MiMo, Gemini, OpenRouter, Groq, Mistral, xAI, Moonshot,
  Z.ai, Qwen, MiniMax, Together, Fireworks, Ollama, LM Studio, AgentRouter,
  or any OpenAI or Anthropic compatible endpoint. Keys stay in your Mac's
  keychain and are never returned, logged or put in a prompt.
- Two company kinds: a software studio and a hedge fund.
- Connectors: MCP servers (local and remote) and HTTP APIs with OpenAPI.
- Trading with safety: connect an exchange or broker, the crew learns how to
  use it and every cat uses what it learned. Paper by default; live orders
  run automatically only inside the owner's hard limits.
- Live preview and Open folder for everything the crew builds.
- Token efficiency: stable first prompt layout for prompt caching, role
  scoped tools, budgets and rolling summaries.

## How it runs

The crew engine is a Bun process on your own machine (127.0.0.1:4190): the
Mac app starts it for you, or run it from this repository. The interface is
the same in the app window and on the website. The engine accepts requests
only from its own window and the allowed website origins; there is no login
and no account anywhere.

## Development

Requirements: Bun 1.3.14. Rust stable for the desktop shell.

```bash
bun install
bun run dev
```

Checks:

```bash
bun test
bunx turbo typecheck build
bun run check:boundaries
```

Layout: `apps/api` (Hono engine on Bun), `apps/web` (landing and app),
`apps/desktop` (Tauri 2 shell for macOS), `packages/shared` (wire
contract), `packages/ui` (JAL Core design system), `packages/cats` (the cat
characters, office and tracker), `migrations/`, `docs/`. Architecture:
`docs/architecture.md`.

## License and credit

- Code: [PolyForm Noncommercial License 1.0.0](LICENSE) with required
  notices. Personal and other noncommercial use, study and changes are
  allowed; every copy and every work based on MengAI must keep the visible
  credit **Built by Adefebrian (https://adefebrian.com)** and these terms.
- Commercial use of any kind needs written permission first:
  adefebrianpro@gmail.com.
- The MengAI name, logo, app icons, Oyen and the cat characters are
  reserved brand assets: see [BRAND.md](BRAND.md).
- Rules for AI assistants and coding agents: see [AI-POLICY.md](AI-POLICY.md).
- Not licensed as AI training or fine-tuning data.

MengAI began as a rewrite of the catcomp ("Briworkers") project; see
[NOTICE](NOTICE) for attribution.
