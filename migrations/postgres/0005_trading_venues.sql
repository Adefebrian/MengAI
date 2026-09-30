-- MengAI schema 0005 trading venues (Postgres). Keep in sync with migrations/sqlite/0005_trading_venues.sql.
-- Trading venues: an exchange or broker MCP server or API the owner connects
-- from the Trading menu, on top of one connector row (the connector keeps the
-- tools and the vault secret). profile is what the crew's learning pass found
-- (price tool, symbol format, order parameters and units, rate limits, error
-- meanings) as JSON; the shared skills themselves live in the skills table.
-- orders.venue_id links an order to the venue that priced or placed it.
-- Expand only: one new table, one unique index, one nullable column. No
-- backfill, no update, no drop.
-- JEV be.migration_risk: risk 0.83 (low), reversible 0.14 (a rollback loses
-- the venues and the order links; the connectors, skills and orders stay),
-- so take a backup and have the rollback below ready before the first boot.
--
-- Rollback (only with a backup taken first):
--   alter table orders drop column venue_id;
--   drop index if exists trading_venues_connector_idx;
--   drop table if exists trading_venues;
--   delete from schema_migrations where version = '0005_trading_venues.sql';

-- trading module: one row per venue connection
create table if not exists trading_venues (
  id text primary key,
  owner_id text not null default 'owner',
  connector_id text not null,
  owns_connector bigint not null default 1,
  preset text not null,
  label text not null,
  skill_key text not null,
  target text not null default '',
  mode text not null,
  testnet bigint not null default 0,
  enabled bigint not null default 1,
  status text not null,
  error text,
  profile text not null default '{}',
  settings text not null default '{}',
  skill_version bigint not null default 0,
  learned_at bigint,
  created_at bigint not null,
  updated_at bigint not null
);
create unique index if not exists trading_venues_connector_idx on trading_venues (owner_id, connector_id);

-- trading module: the venue that priced (paper) or placed (live) an order
alter table orders add column venue_id text;
