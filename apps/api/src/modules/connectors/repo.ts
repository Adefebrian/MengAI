// connectors table. The secret itself is never here: secret_ref points into
// the vault and key_hint keeps the last 4 characters for recognition.
import type { AgentRole, ConnectorKind, Risk } from "@mengai/shared";
import type { Db, Row } from "../../core/ports/db";
import { b01, bool, json, num, toJson } from "../../lib/sql";
import type { HttpOperation } from "./ports";

/** One discovered tool as stored (the schema and the call binding travel with it). */
export interface StoredTool {
  name: string;
  local: string;
  remote: string;
  description: string;
  risk: Risk;
  money: boolean;
  schema: Record<string, unknown>;
  http?: HttpOperation;
}

export interface ConnectorRow {
  id: string;
  kind: ConnectorKind;
  label: string;
  target: string;
  authHeader: string | null;
  secretRef: string | null;
  keyHint: string | null;
  openapi: string | null;
  enabled: boolean;
  status: "connected" | "error" | "disabled";
  error: string | null;
  tools: StoredTool[];
  roles: AgentRole[] | null;
  createdAt: number;
  updatedAt: number;
}

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

function fromRow(r: Row): ConnectorRow {
  return {
    id: String(r.id),
    kind: String(r.kind) as ConnectorKind,
    label: String(r.label),
    target: String(r.target),
    authHeader: str(r.auth_header),
    secretRef: str(r.secret_ref),
    keyHint: str(r.key_hint),
    openapi: str(r.openapi),
    enabled: bool(r.enabled),
    status: String(r.status) as ConnectorRow["status"],
    error: str(r.error),
    tools: json<StoredTool[]>(r.tools, []),
    roles: r.roles === null || r.roles === undefined ? null : json<AgentRole[] | null>(r.roles, null),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

export function createConnectorsRepo(db: Db) {
  return {
    async list(): Promise<ConnectorRow[]> {
      return (await db.query`select * from connectors where owner_id = 'owner' order by created_at, id`).map(fromRow);
    },
    async get(id: string): Promise<ConnectorRow | null> {
      const rows = await db.query`select * from connectors where id = ${id} and owner_id = 'owner'`;
      return rows[0] ? fromRow(rows[0]) : null;
    },
    async byLabel(label: string): Promise<ConnectorRow | null> {
      const rows = await db.query`select * from connectors where label = ${label} and owner_id = 'owner'`;
      return rows[0] ? fromRow(rows[0]) : null;
    },
    async insert(c: ConnectorRow): Promise<void> {
      await db.query`insert into connectors (id, kind, label, target, auth_header, secret_ref, key_hint, openapi, enabled, status, error, tools, roles, created_at, updated_at)
        values (${c.id}, ${c.kind}, ${c.label}, ${c.target}, ${c.authHeader}, ${c.secretRef}, ${c.keyHint}, ${c.openapi}, ${b01(c.enabled)}, ${c.status}, ${c.error}, ${toJson(c.tools)}, ${c.roles === null ? null : toJson(c.roles)}, ${c.createdAt}, ${c.updatedAt})`;
    },
    async save(c: ConnectorRow): Promise<void> {
      await db.query`update connectors set label = ${c.label}, target = ${c.target}, auth_header = ${c.authHeader}, secret_ref = ${c.secretRef}, key_hint = ${c.keyHint},
        openapi = ${c.openapi}, enabled = ${b01(c.enabled)}, status = ${c.status}, error = ${c.error}, tools = ${toJson(c.tools)},
        roles = ${c.roles === null ? null : toJson(c.roles)}, updated_at = ${c.updatedAt}
        where id = ${c.id} and owner_id = 'owner'`;
    },
    async remove(id: string): Promise<void> {
      await db.query`delete from connectors where id = ${id} and owner_id = 'owner'`;
    },
  };
}

export type ConnectorsRepo = ReturnType<typeof createConnectorsRepo>;
