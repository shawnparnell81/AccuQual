-- Revokes Supabase's default anon/authenticated grants from every table.
--
-- This app has its own auth (JWT + bcrypt), its own role
-- switch (accuqual_app, see rls-policies.sql), and never uses Supabase's
-- PostgREST auto-API or Supabase Auth. On a plain self-hosted Postgres
-- (local dev, CI) the `anon`/`authenticated` roles don't exist at all. On
-- Supabase specifically, though, every table created by the connecting
-- `postgres` role is auto-granted to `anon`/`authenticated` by a default
-- privilege Supabase configures ahead of time — their platform assumes
-- you'll RLS-gate each table immediately as part of their normal workflow.
--
-- Every table has row-level security on with a policy only for accuqual_app (see rls-policies.sql), so anon/authenticated
-- are refused even without this file. This removes their grants as well: the app has no use for either role.
--
-- Guarded to a no-op wherever anon/authenticated don't exist (local dev,
-- CI) — safe to run everywhere, every time, like every other post-migrate
-- script here.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE ALL ON SCHEMA public FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated';
    EXECUTE 'REVOKE ALL ON SCHEMA public FROM authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated';
  END IF;
END $$;
