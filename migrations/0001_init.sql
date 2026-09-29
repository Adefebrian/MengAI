-- 0001_init.sql
--
-- The table apps/api/src/modules/example would use once its repo is
-- swapped from the in-memory implementation in
-- apps/api/src/modules/example/repo.ts to a real one backed by the DbPort
-- in apps/api/src/core/ports/db.ts. Shape matches repo.ts's `Item` type:
-- { id, name, createdAt }.

-- up
CREATE TABLE IF NOT EXISTS example_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- down
DROP TABLE IF EXISTS example_items;
