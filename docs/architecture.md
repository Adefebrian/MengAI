# System design v2 (draft, source of truth for W1 builders)

Brand: MengAI (scope @mengai). "Meng" is how Indonesians call a cat.

## 1. Goals
- One product, three surfaces: public website (landing), web app (hosted, your own server), macOS app (Tauri 2 shell + Bun API sidecar, local mode). Same React build everywhere.
- Crew of AI agents (shown as living cats) that plan, build, review, test, secure, research, design assets, and operate the local Mac with explicit permission.
- BYOK for any provider and any model. Keys never leave the vault in plaintext except inside the outbound provider request.
- Measurably fewer tokens than legacy: legacy baseline = 5,168,056 tokens over 3 projects, ~3,876 static tokens re-sent per call, 0% cache, unbounded in-wake history.
- JAL modular monolith on Bun + Hono + React + TS. Rust only for the native macOS automation helper.

## 2. Deployment modes (one codebase, ports and adapters pick the mode)
| Concern | local (Mac app) | server (web, your own server) |
|---|---|---|
| DB | SQLite via Bun.SQL (`sqlite://<appdata>/app.db`, WAL) | Postgres via Bun.SQL (`DATABASE_URL`) |
| KV (rate limit, response cache, locks) | in-memory LRU | Redis via Bun RedisClient |
| Blobs (assets, screenshots) | local dir `<appdata>/blobs` | S3 via Bun.s3 (s3.datacenter.jalgroup.id) |
| Vault (API keys) | OS keychain via Bun.secrets (service = bundle id) | envelope AES-256-GCM, KEK from env `VAULT_KEK`, DEK per secret, ciphertext in `vault_items` |
| Auth | single-use launch token -> HttpOnly cookie; API bound to 127.0.0.1 random port; Host + Origin check | owner accounts (argon2id via Bun.password), session cookie, CSRF via Origin check + SameSite |
| Automation (computer control) | enabled when the hands helper is present and TCC grants exist | hard disabled (module not mounted) |
| Shell tool | Seatbelt profile (sandbox-exec) jail to workspace, env scrubbed | runs inside the container workspace, env scrubbed, off by default |

## 3. Repo layout (JAL template)
```
apps/api        Hono modular monolith; src/index.ts (server), src/local.ts (export startLocal)
apps/web        React SPA via Bun.build: landing (/) + app (/app/*)
apps/desktop    Tauri 2 shell (Rust): spawns the compiled Bun API sidecar, window, tray, global kill shortcut
packages/shared wire contract: enums, DTOs, events, API route types, tool->activity map
packages/ui     JAL Core (tokens.css, ui.css, kit) + product components
packages/cats   cat character system (SVG rig, status + activity motion, reduced-motion poses)
packages/config env schema (zod)
services/hands  Rust helper for macOS automation, JSON-RPC 2.0 over stdio (no socket)
migrations/{sqlite,postgres}/NNNN_name.sql
infra/          Dockerfile, docker-compose.yml (api + postgres + redis), coolify.md
docs/           architecture, setup, security, automation, providers, token-efficiency, adr/
tools/          check-boundaries.ts, migrate.ts, bench-tokens.ts
```

## 4. API modules (apps/api/src/modules/<domain>, one public index.ts each)
| Module | Owns tables | Job |
|---|---|---|
| auth | users, sessions | owner login (server), launch token (local), session middleware |
| vault | vault_items | put/get/delete secret by ref; key fingerprints for output redaction |
| providers | providers, model_tiers | BYOK registry, presets, test connection, list models, resolve (tier or role) -> {provider, model} |
| llm (core adapter, not a module) | none | openai-compatible + anthropic adapters behind the LlmProvider port |
| usage | llm_calls | record usage, price table, budgets, cache-hit metrics |
| projects | projects | project CRUD, workspace root binding |
| runs | runs, agents, tasks, handoffs | orchestrator engine: scheduler, agent loop, handoff, review loop, pause/resume/stop |
| context | summaries | context builder: budget, cache-friendly layout, compaction, truncation, dedupe |
| tools | none | tool registry, JSON schemas per role, execution, risk tagging |
| workspace | none | jailed fs ops, file tree, file read for the IDE panel, change events |
| memory | lessons, skills | lesson lifecycle, BM25 retrieval, outcome tracking, promotion |
| jev | decisions | JEV client, product decision catalog, prechecks, fallback heuristics, decision log |
| evals | eval_runs | scripted scenarios with mock LLM, legacy vs v2 token benchmark |
| assets | assets | image and video generation via media adapters, gallery |
| security | scans, findings | dependency audit (OSV), secret scan, config review, finding lifecycle |
| automation | permissions, approvals, audit_log | capability grants, risk classifier, approval queue, hash-chained audit, kill switch |
| events | events | append-only event log, SSE stream with Last-Event-ID replay |
| settings | settings | owner preferences |
| health | none | /api/health |

Boundary law: cross-module calls only via the other module's index.ts; infra only via core/ports.

## 5. Core ports (apps/api/src/core/ports)
db (tagged-template query, tx, dialect), kv, blob, vault, llm (LlmProvider), media (MediaProvider), runner (process exec), hands (automation), judge (JEV), clock, events bus. Adapters in core/adapters, wired in core/container.ts per mode.

## 6. Orchestration engine (runs module)
- Goal -> lead cat plans a task DAG (`create_tasks`: title, spec, acceptance, role, deps, review flag). Bounded: max 12 tasks per plan call, max depth 3.
- Scheduler: a task is ready when deps are done; dispatch to an idle agent of that role (spawn if missing, cap per run, default 4 concurrent agents). Per-provider concurrency and 429-aware token bucket.
- Agent loop per task: build context -> chat -> run tool calls (read-only tools in parallel) -> append truncated results -> compact if over budget -> guards. Ends on `finish`, `handoff`, `ask_human`, guard trip, abort.
- Handoff: `handoff(to_role, title, spec, acceptance, context)` creates a child task with a compact summary; parent waits, resumes with the child's result summary.
- Review loop: tasks flagged `review` spawn a reviewer task; fail -> fix task to the original owner with notes; max 3 rounds; exit via JEV orch.loop_exit.
- Guards: max steps per task (24), identical tool call x3, identical error x3, no-progress x3 steps, per-task wall clock, run token and USD budget (default budget ON: 400k tokens per run, editable), circuit breaker per provider.
- Pause: stop dispatching, agents checkpoint at next step. Stop: abort in-flight calls and processes. Kill switch: global stop + process-group kill + helper stop + revoke approvals.

## 7. Context and token efficiency (context module)
Prompt layout, stable to volatile, for prefix caching:
1. system: role charter (static per role, 250 to 400 tokens) + tool-use rules
2. tools: only the role's tools (5 to 9 tools, not 20)
   [cache breakpoint 1: shared by every agent of that role]
3. run brief: goal, constraints, workspace digest (capped 300 tokens)
4. memory: top-k lessons by BM25 for this task (cap 400 tokens)
   [cache breakpoint 2]
5. task packet: spec, acceptance, dependency result summaries, handoff summary (cap 800)
6. rolling summary of older steps (when compacted)
   [cache breakpoint 3]
7. recent steps verbatim within budget
Rules: per-call input budget = min(12k, 40% of model window); compaction folds the oldest half of steps into the rolling summary (fast tier model, extractive fallback); tool output head 2,000 + tail 1,000 chars with a range hint; fs_read by line range; repeat reads of an unchanged file return a pointer; fs_edit (find/replace patch) instead of full rewrites; output caps per role; OpenAI `prompt_cache_key` = hash(role, run); Anthropic `cache_control` on breakpoints; exact-match response cache for temperature 0 calls (judge, summarize, classify); token estimator self-calibrates from provider usage.
Retry: transient (429, 5xx, 529, network) exp backoff + jitter, max 3, honor Retry-After; context overflow -> compact then retry once; tool arg errors go back to the model as tool results; tools never auto-retried.

## 8. Memory and self-learning (memory module)
- lessons: candidate -> active -> retired. Sources: `record_lesson` tool, automatic reflection after a failed or reworked task (fast tier, 150 token cap).
- retrieval: BM25 over lessons scoped (project, role, global), top 5, cap 400 tokens; each use logged.
- outcome: task success after use -> wins, failure -> losses; score = (wins+1)/(uses+2). Active at score >= 0.6 and uses >= 2, retire at < 0.3 after 5 uses; near-duplicates merged (shingle Jaccard >= 0.8).
- promotion: project -> global via JEV mem.promote with evidence from 2+ projects.
- skills: successful multi-step command or automation sequences saved as named, parameterized procedures (operator and engineer can recall them).
- run digest: lead's final report stored; later runs on the same project get a 300-token history.
Replaces legacy self-tuning prompt rewrites (bloated prompts, and was a no-op on the live loop).

## 9. JEV integration (jev module)
- Client: POST https://api.typesafe.ai/v1/systemone, Bearer key from vault (provider kind `jev`), body {state, model: "jev-latest", questions}, redaction before send, retry 429/529, 15s timeout, 10 min cache on identical (state, questions).
- Product catalog (adapted from JAL): orch.route (role owner + split), orch.model (tier fast/balanced/deep), orch.parallel (only when paths overlap ambiguously; literal overlap is sequential by precheck), orch.loop_exit (exit_done, another_round, change_approach, escalate + meets_ask), orch.escalate (crew, lead, human + reversible), mem.promote (scope + durable), sec.severity, sec.false_positive.
- Precheck in code first, JEV second, catalog thresholds, confidence < 0.5 -> runner-up rule, outage or no key -> deterministic fallback stamped `UNVERIFIED BY JEV`. Every decision persisted and streamed (`decision` event), visible in the Decisions panel.

## 10. BYOK providers
Presets: openai, anthropic (native, cache_control), gemini (OpenAI-compatible endpoint for chat, native for Imagen/Veo), openrouter, groq, deepseek, mistral, xai, together, fireworks, ollama, lmstudio, custom (any OpenAI-compatible base URL); media: fal, replicate; judge: jev. No default model: MengAI is provider agnostic; an unmapped tier borrows the nearest mapped tier, and with nothing mapped the first chat provider the owner added serves with its first model.
Key hygiene: key sent once, stored in vault, DB keeps key_ref + 4-char hint only, never returned, never logged, never in events or prompts; active key values are fingerprinted and scrubbed from any tool output; custom base URLs in server mode must resolve to public IPs (SSRF guard); local mode allows localhost for Ollama and LM Studio.

## 11. Assets
generate_image / generate_video tools + REST. Adapters: OpenAI images, Gemini Imagen and Veo (long-running op), fal queue, Replicate predictions. Stored in blob store + copied into the workspace `assets/`; gallery in UI; cost recorded.

## 12. Security scanning (user's own codebase, defensive)
deps: parse bun.lock, package-lock.json, pnpm-lock.yaml, yarn.lock, requirements.txt, poetry.lock, go.sum, Cargo.lock -> OSV querybatch (sends only package names and versions, needs network consent). secrets: regex + entropy rules, masked output. config: Dockerfile, compose, CORS, cookies, debug flags, committed .env. review: security agent task. Findings graded (JEV sec.severity, rule-table fallback), can become fix tasks.

## 13. Local automation (automation module + services/hands)
Capabilities: fs (outside workspace), shell (outside workspace), browser (open URL, read page), input (mouse, keyboard), screen (screenshot, accessibility tree), apps (open, activate, quit), network (egress). All OFF by default. Modes: off, ask (confirm every mutating action), auto_read (read-only runs, mutating asks). Destructive (delete, overwrite, install, sudo, kill, disk ops) and sensitive (send data out, secure text fields, keychain, payment or send buttons) ALWAYS ask and can never be auto-approved.
Approval sheet shows the exact action (command, path, diff, target rectangle on the screenshot). Audit log is append-only and hash-chained (prev_hash, hash), verifiable and exportable. Kill switch: always-visible header button, tray menu item, global shortcut; aborts everything and is itself audited.
No hidden access: helper speaks only over stdio pipes to the parent process, no listening sockets, no login items, no background after quit, visible indicator while any capability is active.
hands helper (Rust): JSON-RPC 2.0 NDJSON over stdio; methods status, permissions.check, permissions.request, screen.capture, ax.tree, ax.focused, input.move, input.click, input.scroll, input.type, input.key, app.open, app.activate, app.list, stop. Refuses input while secure event input is on. Contract owned by Bun (packages/shared/hands.ts + JSON schema), contract test spawns the helper.

## 14. Events (events module)
Append-only `events(seq, run_id, ts, type, agent_id, task_id, data)`. SSE `GET /api/events?run=<id>` with Last-Event-ID replay, heartbeat 15s. Types in packages/shared/events.ts. Tool outputs never in events (summaries only); full output via REST.

## 15. Frontend
Routes: `/` landing; `/app` home (runs, new run); `/app/runs/:id` crew board (cats), task queue, timeline, usage, decisions, files; `/app/providers`; `/app/memory`; `/app/assets`; `/app/security`; `/app/automation` (capabilities, approvals, audit, live screen); `/app/evals`; `/app/settings`. Tiny history router, store = reducer over SSE events via useSyncExternalStore, Framer Motion for layout handoffs, CSS keyframes for cat loops, IntersectionObserver pauses offscreen cats, reduced motion = static poses.

## 16. Security baseline
Secure headers (strict CSP, frame-ancestors none, nosniff, referrer no-referrer, HSTS in server mode), Kv-backed rate limits, same-origin CORS allowlist, zod validation on every route, 1 MB body cap (upload routes excepted), request ids, structured logs through redact(), no stack traces to clients, dependency audit in CI.

## 17. Module factories, dependencies and file ownership (W1 contract)

Every module: `apps/api/src/modules/<name>/index.ts` exports
`create<Name>Module(ctx: ModuleContext, deps): MountedModule & { service }`.
`core/container.ts` (written in the integration wave) builds ports for the
mode, then creates modules in this order and passes services down:

| Module | deps it receives | service it exports |
|---|---|---|
| settings | none | SettingsService |
| events | none (implements EventSink; placed into ctx.events for everyone else) | EventSink |
| auth | none | session middleware helpers (core/auth.ts uses them) |
| health | { llmConfigured(), jevConfigured(), automationStatus() } callbacks | none |
| usage | { settings } | UsageService |
| providers | { usage } (vault via ctx) | ProvidersService (llm, media, judge, list) |
| jev | { judge: providers.service.judge } | DecisionService |
| projects | { workspace } | ProjectsService |
| workspace | { runner } | WorkspaceService |
| context | none | ContextService |
| memory | { llm: providers.service.llm, decisions: DecisionService, usage } | MemoryService |
| automation | { hands, killswitch } | AutomationService |
| assets | { media: providers.service.media, workspace, usage, settings } | AssetsService |
| security | { workspace, decisions, settings } | SecurityService |
| tools | { workspace, runner, memory, assets, security, automation, settings, projects } | ToolsService |
| runs | { projects, llm, usage, context, memory, tools, decisions, settings, killswitch, automation } | RunsService |
| evals | { context } (W1); { runs factory + mock llm } (W2) | eval harness |

Route mount paths follow `packages/shared/src/api.ts` (`/api/<segment>`).
Routes never contain business logic; services never import Hono.

### Local sidecar contract (apps/api/src/local.ts <-> apps/desktop)
- The desktop shell spawns the compiled sidecar with env `MENGAI_MODE=local`,
  `MENGAI_DATA_DIR`, `MENGAI_WEB_DIR` (bundled SPA), `MENGAI_HANDS_BIN`
  (bundled helper), optional `MENGAI_PORT` (default: random free port on 127.0.0.1).
- When listening, the sidecar prints exactly one NDJSON line to stdout:
  `{"event":"ready","port":<n>,"launchToken":"<one-time>","controlToken":"<per-launch>"}`.
- The shell opens `http://127.0.0.1:<port>/#launch=<launchToken>`; the web app
  posts it to `POST /api/auth/launch` once and gets the session cookie.
- Tray and global shortcut call `POST /api/killswitch` with header
  `x-mengai-control: <controlToken>` (see CONTROL_TOKEN_HEADER in shared).
- The sidecar exits on SIGTERM or when stdin closes; the shell always sends
  SIGTERM on quit and kills the process group after 3 s.

### File ownership in W1 (one owner per path, no exceptions)
| Workstream | Owns |
|---|---|
| platform | apps/api/src/core/{app,config,hardening,auth,killswitch,logger}.ts, core/adapters/{kv-*,blob-*,vault-*,logger}.ts, modules/{auth,settings,health,events}, apps/api/src/{index,local,index.test}.ts, packages/config/src, .env.example, infra/ |
| providers | modules/{providers,usage}, core/adapters/{llm-*,media-*,judge-jev}.ts |
| workspace | modules/{projects,workspace,tools}, core/adapters/runner-*.ts |
| context | modules/{context,memory} |
| runs | modules/runs |
| jev | modules/{jev,evals} |
| security | modules/{security,assets} |
| automation | modules/automation, core/adapters/hands-stdio.ts |
| hands | services/hands |
| cats | packages/cats |
| web | apps/web (except src/landing), packages/ui/src/product |
| landing | apps/web/src/landing |
| desktop | apps/desktop |
| direction | docs/design |
