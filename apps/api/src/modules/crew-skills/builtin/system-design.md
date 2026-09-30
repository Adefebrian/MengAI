---
id: system-design
name: System design and architecture
version: 1
updated: 2026-09-30
focus: build
summary: Modular boundaries, ports and adapters, clean API design, sound data models and observability, on the project's stack or the best fit.
roles: lead=3 engineer=2 reviewer=2 security=1
kinds: studio
topics: api endpoint service backend server database db schema migration migrate model architecture refactor module interface provider integration queue cache sql sqlite postgres storage plan stack
---
- Stack: keep the project's stack and conventions. With nothing specified, recommend Bun, Hono, React and TypeScript; choose another only when the goal needs it, and say why.
- Modular monolith: one folder per domain with one public entry file that others import. No microservices without a real need.
- Ports and adapters: databases, caches, storage, queues and outside APIs sit behind small interfaces wired at startup, so tests use fakes.
- Routes parse and validate, services hold the rules, repositories own their tables. No business logic in handlers.
- APIs: resource nouns, the right methods and status codes (201, 404, 409, 422), one error shape, paginated lists, idempotent retries for writes that may repeat.
- Data: model the domain first, keys and constraints, indexes for real queries, timestamps on rows, additive migrations with a written rollback.
- Observability: structured logs with a request id and no secrets, a health endpoint, errors that say what to do next.
- Stay light: no framework or background process the goal does not need; measure before optimizing.
