// What the connectors module exposes and what it needs. The service is
// injected by core/container.ts into the tools bridge and the trading
// module; the process port below keeps Bun.spawn out of the service so the
// tests can drive a fake MCP server.
import type { AgentRole, ConnectorDTO, ConnectorTool, CreateConnectorBody, UpdateConnectorBody } from "@mengai/shared";

/** How an http_api tool maps onto the remote API. */
export interface HttpOperation {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** path under the base URL, with {name} placeholders */
  path: string;
  params: Array<{ name: string; in: "path" | "query" | "header" }>;
  /** the arguments carry a JSON body under "body" */
  body: boolean;
  /** the two tools of an http_api without an OpenAPI document */
  generic?: "get" | "send";
}

/** A connector tool as the bridge sees it: the DTO fields plus how to call it. */
export interface ConnectorToolDef extends ConnectorTool {
  connectorId: string;
  connectorLabel: string;
  /** the name on the remote side: the MCP tool name or the operation key */
  remote: string;
  /** provider-safe function name the model sees ("binance__get_ticker") */
  alias: string;
  /** order placement or fund movement: only the trading gate may call it */
  money: boolean;
  /** JSON Schema (the tool validator's subset) of the arguments */
  schema: Record<string, unknown>;
  http?: HttpOperation;
}

export interface ConnectorCallResult {
  ok: boolean;
  output: string;
  durationMs: number;
}

export interface ConnectorsService {
  list(): Promise<ConnectorDTO[]>;
  create(body: CreateConnectorBody): Promise<ConnectorDTO>;
  update(id: string, body: UpdateConnectorBody): Promise<ConnectorDTO>;
  remove(id: string): Promise<void>;
  /** reconnects, refreshes the tool list and clears a kill switch stop */
  test(id: string): Promise<ConnectorDTO>;
  /** tools of enabled, connected connectors this role may use; without a role, every connector's (the trading venue) */
  tools(scope: { role?: AgentRole }): Promise<ConnectorToolDef[]>;
  /** runs one tool by its namespaced name or alias; never throws for a remote failure */
  call(name: string, args: Record<string, unknown>, opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<ConnectorCallResult>;
  /** stored secrets reach the redactor before the server listens */
  warm(): Promise<void>;
  /** kill switch: kills every MCP server process; they stay down until the owner tests the connector */
  killAll(): Promise<number>;
  close(): Promise<void>;
}

/** One running MCP stdio server. */
export interface SpawnedProcess {
  readonly pid: number;
  write(data: string): void;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  /** resolves with the exit code (null when killed by a signal) */
  readonly exited: Promise<number | null>;
  /** kills the process group */
  kill(): void;
}

export type Spawner = (argv: string[], opts: { env: Record<string, string>; cwd: string }) => SpawnedProcess;

/** DNS lookup for the SSRF guard (tests inject one). */
export type LookupFn = (host: string) => Promise<Array<{ address: string; family: number }>>;
