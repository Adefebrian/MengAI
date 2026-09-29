-- MengAI schema 0002 brain (Postgres). Keep in sync with migrations/sqlite/0002_brain.sql.
-- Learned strategy addenda (per role key and per agent) and the role outcome log,
-- dynamic roles, the runtime brain decisions, and the hire, departure and mind
-- facts of every agent.
-- Expand only: new tables and nullable columns, no backfill, no update, no drop.
-- JEV be.migration_risk: risk 0.87 (low), reversible 0.25 (a rollback loses
-- the learned strategies, roles and brain decisions), so take a backup and
-- have the rollback below ready before the first production boot.
--
-- Rollback (only with a backup taken first):
--   drop table if exists brain_decisions;
--   drop table if exists roles;
--   drop table if exists strategies;
--   drop table if exists role_outcomes;
--   alter table context_snapshots drop column mind;
--   alter table tasks drop column role_id;
--   alter table agents drop column role_title;
--   alter table agents drop column role_id;
--   alter table agents drop column left_reason;
--   alter table agents drop column hired_by;
--   alter table agents drop column hire_reason;
--   delete from schema_migrations where version = '0002_brain.sql';

-- memory module: the outcome log a role learns from (role = base role or dynamic role key)
create table if not exists role_outcomes (
  id text primary key,
  role text not null,
  run_id text,
  task_id text,
  agent_id text,
  outcome text not null,
  kind text not null,
  cause text not null default '',
  strategy_version bigint not null default 0,
  created_at bigint not null
);
create index if not exists role_outcomes_role_idx on role_outcomes (role, created_at);

-- memory module: versioned strategy addenda per role key or per agent
create table if not exists strategies (
  id text primary key,
  subject_kind text not null,
  subject_key text not null,
  archetype text not null,
  version bigint not null,
  text text not null,
  tokens bigint not null,
  status text not null,
  choice text,
  decision_ref text,
  confidence double precision,
  verified bigint not null default 0,
  stamp text,
  evidence text,
  reason text not null default '',
  source_run_id text,
  created_at bigint not null
);
create index if not exists strategies_subject_idx on strategies (subject_kind, subject_key, status);
-- adopted versions are unique per subject; a rejected candidate keeps the number it would have taken
create unique index if not exists strategies_version_idx on strategies (subject_kind, subject_key, version) where status <> 'rejected';

-- runs module: roles the crew defined from context, per project
create table if not exists roles (
  id text primary key,
  project_id text not null,
  run_id text,
  key text not null,
  title text not null,
  archetype text not null,
  charter text not null,
  charter_version bigint not null default 1,
  tools text not null default '[]',
  reason text not null default '',
  created_by text,
  decision_ref text,
  created_at bigint not null,
  updated_at bigint not null
);
create unique index if not exists roles_project_key_idx on roles (project_id, key);

-- runs module: the product's runtime brain decisions (prompt.adopt, orch.role, orch.hire, orch.let_go)
create table if not exists brain_decisions (
  id text primary key,
  run_id text,
  agent_id text,
  subject text,
  decision_id text not null,
  domain text not null,
  state_digest text not null,
  questions text not null,
  answers text not null,
  action text not null,
  confidence double precision,
  verified bigint not null,
  stamp text,
  latency_ms bigint not null default 0,
  created_at bigint not null
);
create index if not exists brain_decisions_run_idx on brain_decisions (run_id, created_at);

-- runs module: hire and departure facts, dynamic roles, and the mind snapshot per agent
alter table agents add column hire_reason text;
alter table agents add column hired_by text;
alter table agents add column left_reason text;
alter table agents add column role_id text;
alter table agents add column role_title text;
alter table tasks add column role_id text;
alter table context_snapshots add column mind text;
