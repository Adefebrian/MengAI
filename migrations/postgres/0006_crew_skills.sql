-- MengAI schema 0006 crew skills (Postgres). Keep in sync with migrations/sqlite/0006_crew_skills.sql.
-- Crew skills: written instructions every matching cat reads in its prompt.
-- The built-in pack ships as versioned files inside the app (never stored,
-- never edited); crew_skill_state keeps only whether the owner switched a
-- built-in off. crew_skills holds the owner's own skills. roles and kinds
-- are JSON arrays, null meaning every role or every company kind. name_key
-- is the trimmed, lower-cased name, unique per owner.
-- Expand only: two new tables and two indexes. No backfill, no update, no
-- drop, no change to an existing table.
-- JEV be.migration_risk: risk 0.67 (low), reversible 0.25 (a rollback loses
-- the owner's skills and the switched-off built-ins; nothing else is
-- touched), so take a backup and have the rollback below ready before the
-- first boot.
--
-- Rollback (only with a backup taken first):
--   drop index if exists crew_skills_created_idx;
--   drop index if exists crew_skills_name_idx;
--   drop table if exists crew_skills;
--   drop table if exists crew_skill_state;
--   delete from schema_migrations where version = '0006_crew_skills.sql';

-- crew-skills module: the owner's own written skills
create table if not exists crew_skills (
  id text primary key,
  owner_id text not null default 'owner',
  name text not null,
  name_key text not null,
  summary text not null default '',
  body text not null,
  roles text,
  kinds text,
  enabled bigint not null default 1,
  version bigint not null default 1,
  created_at bigint not null,
  updated_at bigint not null
);
create unique index if not exists crew_skills_name_idx on crew_skills (owner_id, name_key);
create index if not exists crew_skills_created_idx on crew_skills (owner_id, created_at);

-- crew-skills module: the enabled flag of a built-in skill (no row means on)
create table if not exists crew_skill_state (
  owner_id text not null default 'owner',
  skill_id text not null,
  enabled bigint not null default 1,
  updated_at bigint not null,
  primary key (owner_id, skill_id)
);
