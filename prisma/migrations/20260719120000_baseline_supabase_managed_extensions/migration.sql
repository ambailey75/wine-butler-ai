-- Baseline migration: these four extensions already exist in the live
-- database. Supabase enabled them automatically at project creation --
-- none of them were ever created by a prior Prisma migration, which is
-- why Prisma's migration history had no record of them and reported
-- "drift" when compared against the real database.
--
-- This file is NOT executed against the database. It exists only so
-- Prisma's migration history has an entry describing these extensions.
-- It gets registered via:
--   npx prisma migrate resolve --applied "20260719120000_baseline_supabase_managed_extensions"
-- which marks this migration as already applied WITHOUT running the SQL
-- below -- a metadata-only operation that cannot touch any table or row.
--
-- See WINE_KNOWLEDGE_DATABASE_PLAN.md, "Extension-drift fix (2026-07-19)".

CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- "vault" is a named container inside the database that supabase_vault
-- lives in. On the real database it already exists (Supabase created it),
-- but a fresh/empty database (like Prisma's temporary shadow database used
-- to test-replay this history) starts with nothing -- so this file has to
-- be able to create it too, safely, only if it isn't already there.
CREATE SCHEMA IF NOT EXISTS "vault";

CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
