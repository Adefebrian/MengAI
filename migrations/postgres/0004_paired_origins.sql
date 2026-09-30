-- MengAI schema 0004 paired origins (Postgres). Keep in sync with migrations/sqlite/0004_paired_origins.sql.
-- Local-first bridge: the public website only serves the UI and talks to the
-- runtime on the owner's own machine. A browser pairs with a one-time token
-- (POST /api/auth/pair); the runtime remembers the calling origin (exact, at
-- most 10) for CORS and binds the bearer session it issues to that origin.
-- Expand only: one new table, one nullable column, one index. No backfill,
-- no update, no drop.
-- JEV be.migration_risk: risk 0.89 (low), reversible 0.46 (a rollback loses
-- the paired sites and their sessions), so take a backup and have the
-- rollback below ready before the first production boot.
--
-- Rollback (only with a backup taken first):
--   drop index if exists sessions_origin_idx;
--   alter table sessions drop column origin;
--   drop table if exists paired_origins;
--   delete from schema_migrations where version = '0004_paired_origins.sql';

-- auth module: websites allowed to call this runtime cross-origin
create table if not exists paired_origins (
  origin text primary key,
  created_at bigint not null,
  last_paired_at bigint not null
);

-- auth module: a paired (bearer) session is bound to the origin that paired it;
-- null for cookie sessions (desktop window, server login)
alter table sessions add column origin text;
create index if not exists sessions_origin_idx on sessions (origin);
