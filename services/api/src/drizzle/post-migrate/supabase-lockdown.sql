-- Revokes Supabase's default anon/authenticated grants from every table.
--
-- This app has its own auth (JWT + bcrypt), its own tenant-scoped role
-- switch (accuqual_app, see rls-policies.sql), and never uses Supabase's
-- PostgREST auto-API or Supabase Auth. On a plain self-hosted Postgres
-- (local dev, CI) the `anon`/`authenticated` roles don't exist at all. On
-- Supabase specifically, though, every table created by the connecting
-- `postgres` role is auto-granted to `anon`/`authenticated` by a default
-- privilege Supabase configures ahead of time — their platform assumes
-- you'll RLS-gate each table immediately as part of their normal workflow.
--
-- For the ~46 tables rls-policies.sql actually puts a tenant_isolation
-- policy on, this was already harmless in practice: RLS applies to anon/
-- authenticated exactly like any other non-owner, non-superuser role, and
-- Supabase's REST API never sets this app's app.current_tenant_id session
-- variable, so those policies return zero rows regardless of who's asking.
--
-- It was NOT harmless for the handful of tables deliberately left outside
-- that array (tenants, roles, nav_hidden_items, password_reset_tokens —
-- see rls-policies.sql's own comment on why) — those had zero protection
-- against Supabase's default grant, full stop. Since this app has no
-- legitimate use for anon/authenticated at all, the real fix is removing
-- their access everywhere, not adding RLS policies to more tables.
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
