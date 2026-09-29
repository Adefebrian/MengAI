# services/ - polyglot sidecars

`apps/` and `packages/` are the Bun/TypeScript/Hono/React core of this template, per
`jal-standards`. `services/` is where a workload that genuinely does not fit that stack
lives instead: a Go binary doing CPU-bound work, a Python process for an ML model, a Rust
tool for something latency-critical, anything that has no reasonable Bun/TypeScript
equivalent. This is the exception path, not a parallel default; most new work belongs in
`apps/` or `packages/`, not here.

## When a service belongs here

- The workload needs a runtime, library, or performance characteristic TypeScript/Bun
  cannot reasonably provide (e.g. a specific ML framework, a CPU-bound algorithm where a
  compiled language matters, a protocol library that only exists in another ecosystem).
- It is a genuinely separate deployable unit, not a module that could live inside
  `apps/api/src/modules/`.
- A justification for the new language is recorded as an ADR under `docs/adr/` (see
  `0001-record-architecture-decisions.md`) before the sidecar is added, per
  `jal-architect`'s gatekeeping role over new technology.

## Layout

```
services/
  <service-name>/
    Dockerfile
    src/...
    README.md          # what it does, why it is not TypeScript, how to run it locally
proto/
  <service-name>.proto  # the contract, shared source of truth for every consumer
```

Each sidecar is its own directory under `services/`, with its own `Dockerfile` and its own
build/test tooling native to its language. Nothing under `services/` is a Bun/Turborepo
workspace member; it does not appear in the root `workspaces` array, and `turbo run build`
never builds it. It is built, tested, and deployed as an independent container.

## Proto-first contracts

Every sidecar's API is defined as a `.proto` file under `proto/` before any implementation
code is written. The proto file is the contract: the sidecar implements a gRPC server
against it, and any TypeScript caller in `apps/api` generates a typed client from the same
file. Nobody hand-writes a client against a sidecar's HTTP/gRPC surface from memory; it is
always generated from `proto/<service-name>.proto`.

See `proto/example.proto` for a minimal sample service definition to use as a starting
point for a new sidecar's contract.

## Transport: gRPC

Sidecars speak gRPC, not a hand-rolled REST API:

- The `.proto` file is the single source of truth for the request/response shapes and the
  available RPCs, checked into version control alongside the code that implements it.
- Streaming, strict typing, and codegen for both the sidecar's own language and the
  TypeScript caller in `apps/api` come for free from the same file, instead of being kept
  in sync by hand across two codebases.
- `apps/api` talks to a sidecar through a small adapter behind a core port (see
  `apps/api/src/core/ports/`), exactly like the Postgres/Redis/S3 adapters: a module in
  `apps/api/src/modules/` never dials a gRPC sidecar directly, it depends on a port, and the
  port's adapter is the one place that holds the generated gRPC client.

## Deploying a sidecar

A sidecar deploys the same way `apps/api` and `apps/web` do (see `infra/coolify.md`): its
own `Dockerfile`, its own Coolify application, pointed at `services/<service-name>/Dockerfile`
with the build context at the repo root so it can pull in `proto/` during the image build.
It gets its own health check path and its own set of environment variables, and it is tagged
and rolled back independently of the two main apps.
