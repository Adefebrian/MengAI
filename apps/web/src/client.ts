// Typed Hono RPC client for apps/api, built from that app's own route types
// (see apps/api/src/core/app.ts's `AppType`), so a call like
// `api.example.$get()` is checked against the real request/response shapes
// at build time instead of being hand-typed and left to drift.
//
// The `AppType` import below is `import type` only, so Bun's transpiler
// elides it entirely from the bundle: apps/api's runtime code (Postgres,
// Redis, S3, OpenAI clients) never ships to the browser, only the type
// information tsc needs is pulled in, and only at typecheck time.
import { hc } from "hono/client";
import type { AppType } from "@crew/api/src/core/app";

// `import.meta.env` is a Vite convention, not a Bun one; this repo has no
// Vite dev server (see README "Stack"), so nothing defines `env` on
// `ImportMeta` here. Read it defensively through a local cast instead of
// widening the global `ImportMeta` type just for one optional override.
const apiUrl = (import.meta as unknown as { env?: { API_URL?: string } }).env?.API_URL ?? "http://localhost:3001";

export const api = hc<AppType>(apiUrl);
