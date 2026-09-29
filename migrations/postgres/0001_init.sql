-- MengAI schema v1 (Postgres). Keep in sync with migrations/sqlite/0001_init.sql.
create table if not exists users (
  id text primary key,
  email text not null unique,
  pass_hash text not null,
  created_at bigint not null
);

create table if not exists sessions (
  id text primary key,
  user_id text not null,
  token_hash text not null unique,
  created_at bigint not null,
  expires_at bigint not null,
  last_seen_at bigint not null
);

create table if not exists vault_items (
  ref text primary key,
  ciphertext text not null,
  iv text not null,
  dek_wrapped text not null,
  created_at bigint not null,
  updated_at bigint not null
);

create table if not exists providers (
  id text primary key,
  owner_id text not null default 'owner',
  preset text not null,
  label text not null,
  protocol text not null,
  base_url text not null,
  key_ref text,
  key_hint text,
  models text not null default '[]',
  caps text not null default '[]',
  last_test_at bigint,
  last_test_ok bigint,
  last_test_error text,
  created_at bigint not null,
  updated_at bigint not null
);

create table if not exists settings (
  owner_id text not null default 'owner',
  key text not null,
  value text not null,
  updated_at bigint not null,
  primary key (owner_id, key)
);

create table if not exists projects (
  id text primary key,
  owner_id text not null default 'owner',
  name text not null,
  workspace_path text not null,
  created_at bigint not null,
  updated_at bigint not null
);

create table if not exists runs (
  id text primary key,
  owner_id text not null default 'owner',
  project_id text not null,
  goal text not null,
  status text not null,
  status_reason text,
  budget_tokens bigint not null,
  budget_usd double precision not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cached_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  cost_usd double precision not null default 0,
  calls bigint not null default 0,
  started_at bigint,
  ended_at bigint,
  created_at bigint not null,
  updated_at bigint not null
);
create index if not exists runs_project_idx on runs (project_id, created_at);
create index if not exists runs_status_idx on runs (status);

create table if not exists agents (
  id text primary key,
  run_id text not null,
  parent_id text,
  role text not null,
  name text not null,
  coat text not null,
  seed bigint not null,
  tier text not null,
  status text not null,
  activity text not null,
  mood text not null,
  status_text text,
  current_task_id text,
  steps bigint not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cached_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  cost_usd double precision not null default 0,
  calls bigint not null default 0,
  wins bigint not null default 0,
  losses bigint not null default 0,
  created_at bigint not null,
  updated_at bigint not null
);
create index if not exists agents_run_idx on agents (run_id);

create table if not exists tasks (
  id text primary key,
  run_id text not null,
  parent_id text,
  title text not null,
  spec text not null,
  acceptance text not null default '[]',
  role text not null,
  assignee_id text,
  status text not null,
  priority bigint not null default 0,
  deps text not null default '[]',
  review bigint not null default 0,
  attempts bigint not null default 0,
  max_attempts bigint not null default 3,
  result_summary text,
  created_by text,
  created_at bigint not null,
  updated_at bigint not null,
  started_at bigint,
  ended_at bigint
);
create index if not exists tasks_run_idx on tasks (run_id, status);

create table if not exists handoffs (
  id text primary key,
  run_id text not null,
  task_id text not null,
  from_agent_id text not null,
  to_agent_id text,
  to_role text not null,
  summary text not null,
  created_at bigint not null
);
create index if not exists handoffs_run_idx on handoffs (run_id);

create table if not exists llm_calls (
  id text primary key,
  run_id text,
  agent_id text,
  task_id text,
  provider_id text not null,
  model text not null,
  purpose text not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cached_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  cost_usd double precision not null default 0,
  latency_ms bigint not null default 0,
  retries bigint not null default 0,
  ok bigint not null default 1,
  error text,
  prompt_hash text,
  created_at bigint not null
);
create index if not exists llm_calls_run_idx on llm_calls (run_id, created_at);
create index if not exists llm_calls_time_idx on llm_calls (created_at);

create table if not exists tool_calls (
  id text primary key,
  run_id text not null,
  agent_id text not null,
  task_id text,
  tool text not null,
  args text not null,
  output text not null,
  ok bigint not null,
  duration_ms bigint not null,
  created_at bigint not null
);
create index if not exists tool_calls_run_idx on tool_calls (run_id, created_at);

create table if not exists summaries (
  id text primary key,
  run_id text not null,
  agent_id text,
  task_id text,
  kind text not null,
  text text not null,
  tokens bigint not null,
  covers_to bigint not null default 0,
  created_at bigint not null
);
create index if not exists summaries_task_idx on summaries (task_id, created_at);

create table if not exists context_snapshots (
  agent_id text primary key,
  run_id text not null,
  task_id text,
  model text not null,
  budget bigint not null,
  layers text not null,
  total_tokens bigint not null,
  compactions bigint not null default 0,
  last_cached_tokens bigint not null default 0,
  created_at bigint not null
);

create table if not exists lessons (
  id text primary key,
  owner_id text not null default 'owner',
  scope text not null,
  role text,
  project_id text,
  text text not null,
  tags text not null default '[]',
  status text not null,
  uses bigint not null default 0,
  wins bigint not null default 0,
  losses bigint not null default 0,
  score double precision not null default 0.5,
  source_run_id text,
  created_at bigint not null,
  last_used_at bigint
);
create index if not exists lessons_scope_idx on lessons (scope, role, status);

create table if not exists lesson_uses (
  lesson_id text not null,
  task_id text not null,
  run_id text not null,
  outcome text,
  created_at bigint not null,
  primary key (lesson_id, task_id)
);

create table if not exists skills (
  id text primary key,
  owner_id text not null default 'owner',
  name text not null,
  description text not null,
  role text,
  steps text not null,
  uses bigint not null default 0,
  wins bigint not null default 0,
  created_at bigint not null,
  updated_at bigint not null,
  unique (owner_id, name)
);

create table if not exists decisions (
  id text primary key,
  run_id text,
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
create index if not exists decisions_run_idx on decisions (run_id, created_at);

create table if not exists permissions (
  owner_id text not null default 'owner',
  capability text not null,
  mode text not null,
  scope text not null default '[]',
  expires_at bigint,
  updated_at bigint not null,
  primary key (owner_id, capability)
);

create table if not exists approvals (
  id text primary key,
  run_id text,
  agent_id text,
  capability text not null,
  risk text not null,
  title text not null,
  detail text not null,
  status text not null,
  scope text not null default 'once',
  created_at bigint not null,
  decided_at bigint,
  expires_at bigint not null
);
create index if not exists approvals_status_idx on approvals (status, created_at);

create table if not exists assets (
  id text primary key,
  owner_id text not null default 'owner',
  run_id text,
  kind text not null,
  status text not null,
  provider_id text not null,
  model text not null,
  prompt text not null,
  blob_key text,
  mime text,
  width bigint,
  height bigint,
  duration_ms bigint,
  cost_usd double precision not null default 0,
  error text,
  job_id text,
  created_at bigint not null,
  updated_at bigint not null
);
create index if not exists assets_time_idx on assets (created_at);

create table if not exists scans (
  id text primary key,
  project_id text not null,
  kinds text not null,
  status text not null,
  counts text not null default '{}',
  error text,
  created_at bigint not null,
  finished_at bigint
);
create index if not exists scans_project_idx on scans (project_id, created_at);

create table if not exists findings (
  id text primary key,
  scan_id text not null,
  kind text not null,
  severity text not null,
  rule text not null,
  title text not null,
  file text,
  line bigint,
  detail text not null,
  fix text,
  status text not null default 'open',
  fingerprint text not null,
  created_at bigint not null
);
create index if not exists findings_scan_idx on findings (scan_id);

create table if not exists eval_runs (
  id text primary key,
  suite text not null,
  policy text not null,
  metrics text not null,
  created_at bigint not null
);

create table if not exists events (
  seq bigint generated always as identity primary key,
  run_id text,
  ts bigint not null,
  type text not null,
  agent_id text,
  task_id text,
  data text not null
);
create index if not exists events_run_idx on events (run_id, seq);

create table if not exists audit_log (
  seq bigint generated always as identity primary key,
  ts bigint not null,
  actor text not null,
  run_id text,
  agent_id text,
  capability text not null,
  action text not null,
  target text not null,
  risk text not null,
  outcome text not null,
  detail text not null,
  prev_hash text not null,
  hash text not null
);
