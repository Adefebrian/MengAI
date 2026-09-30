---
id: security-qa
name: Security hardening and QA habits
version: 1
updated: 2026-09-30
focus: build
summary: Validate input, keep secrets out of code, harden headers and rate limits, test at the right level and self-check UI before calling work done.
roles: security=3 qa=3 reviewer=2 engineer=2
kinds: studio
topics: security secure auth login password token secret release test testing flaky ci qa validation input audit vulnerability payment checkout public deploy bug
---
- Validate every body, query and path parameter with a schema at the boundary; reject with a clear 4xx before any logic.
- Secrets come from the environment or a vault only: never in code, commits, logs, prompts or errors. .env stays out of git; .env.example lists the keys.
- Harden by default: secure headers (CSP, nosniff, frame-ancestors, referrer policy, HSTS behind TLS), an exact CORS allowlist, rate limits per route and client with 429 and Retry-After, stricter on login.
- Parameterized queries, escaped output, authorization checked on every object, not only at login. Audit dependencies before release.
- Test at the right level: unit tests for rules, API tests through the request handler, a few browser smoke tests for key flows. No real network, clock or shared state.
- Cases come from acceptance criteria first, then edges: empty, limits, errors, permissions, concurrency.
- A test you did not run did not pass: quote the real command and result.
- UI self-check before done: ui_check, then 320, 375, 768 and 1280 px for overlap, clipped text, gaps and sideways scroll, plus keyboard focus and reduced motion.
