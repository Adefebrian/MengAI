-- MengAI schema 0003 capabilities (Postgres). Keep in sync with migrations/sqlite/0003_capabilities.sql.
-- The company kind of a run, external connectors (MCP servers and HTTP APIs)
-- and trading (owner settings, orders, positions).
-- Expand only: new tables and one nullable column, no backfill, no update, no drop.
-- JEV be.migration_risk: risk 0.91 (low), reversible 0.49 (a rollback loses the
-- connectors, orders and positions), so take a backup and have the rollback
-- below ready before the first production boot.
--
-- Rollback (only with a backup taken first):
--   drop table if exists positions;
--   drop table if exists orders;
--   drop table if exists trading_settings;
--   drop table if exists connectors;
--   alter table runs drop column company;
--   delete from schema_migrations where version = '0003_capabilities.sql';

-- runs module: studio or fund; null reads as studio
alter table runs add column company text;

-- connectors module: MCP servers (stdio, streamable HTTP) and HTTP APIs.
-- The secret lives in the vault under secret_ref ("connector:<id>"); tools is
-- the discovered tool list as JSON (namespaced names, risk, input schema).
create table if not exists connectors (
  id text primary key,
  owner_id text not null default 'owner',
  kind text not null,
  label text not null,
  target text not null,
  auth_header text,
  secret_ref text,
  key_hint text,
  openapi text,
  enabled bigint not null default 1,
  status text not null,
  error text,
  tools text not null default '[]',
  roles text,
  created_at bigint not null,
  updated_at bigint not null
);
create unique index if not exists connectors_label_idx on connectors (owner_id, label);

-- trading module: one settings row per owner (TradingSettings as JSON), halted
-- by the kill switch until the owner saves the settings again
create table if not exists trading_settings (
  owner_id text primary key,
  value text not null,
  halted_at bigint,
  halt_reason text,
  updated_at bigint not null
);

create table if not exists orders (
  id text primary key,
  owner_id text not null default 'owner',
  run_id text,
  agent_id text,
  symbol text not null,
  side text not null,
  qty double precision not null,
  type text not null,
  limit_price double precision,
  quote double precision,
  mode text not null,
  status text not null,
  venue text,
  venue_tool text,
  reason text not null default '',
  risk_note text,
  risk_verdict text,
  risk_agent_id text,
  fill_price double precision,
  realized_usd double precision not null default 0,
  error text,
  created_at bigint not null,
  decided_at bigint,
  filled_at bigint,
  updated_at bigint not null
);
create index if not exists orders_owner_idx on orders (owner_id, created_at);
create index if not exists orders_run_idx on orders (run_id, created_at);

create table if not exists positions (
  owner_id text not null default 'owner',
  mode text not null,
  symbol text not null,
  qty double precision not null,
  avg_price double precision not null,
  last_price double precision,
  realized_usd double precision not null default 0,
  updated_at bigint not null,
  primary key (owner_id, mode, symbol)
);
