-- Database access for the application role.
--
-- The app does not run its queries as the database's owner. Each request's transaction switches (SET LOCAL ROLE) into
-- `accuqual_app`, a role that can read and write ordinary tables but is deliberately limited on the audit tables (see
-- audit-triggers.sql), so a bug or injection in application code cannot rewrite history.
--
-- Every table also has row-level security switched on with one simple policy that lets accuqual_app in. That matters on
-- Supabase, whose `ensure_rls` trigger turns RLS on for every new table: with RLS on and no policy the app role would
-- see no rows at all. It also means the database's other roles (Supabase's anon/authenticated) are refused everywhere.
--
-- This is a role-SWITCH, not a second connection: accuqual_app is NOLOGIN, and whatever role this script runs as is
-- granted membership so it can switch into it for one transaction. Run by `npm run db:migrate`; safe to re-run.

DO $$
DECLARE
  owner_role text := current_user;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'accuqual_app') THEN
    EXECUTE 'CREATE ROLE accuqual_app NOLOGIN NOSUPERUSER NOBYPASSRLS';
  END IF;

  -- Lets the connecting role SET ROLE into accuqual_app. Re-granting an already-held membership is a no-op.
  EXECUTE format('GRANT accuqual_app TO %I', owner_role);

  EXECUTE 'GRANT USAGE ON SCHEMA public TO accuqual_app';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO accuqual_app';
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO accuqual_app';

  -- A table/sequence a future migration adds is granted to accuqual_app automatically.
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO accuqual_app', owner_role);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO accuqual_app', owner_role);
END $$;

-- One policy per ordinary table. Left out on purpose: the audit tables (audit-triggers.sql gives them narrower ones),
-- roles (read-only, below) and the three credential tables (deny-all, below).
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN ('audit_trail', 'audit_row_changes', 'roles', 'refresh_tokens', 'mfa_recovery_codes', 'password_reset_tokens')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS app_access ON %I', t);
    EXECUTE format('CREATE POLICY app_access ON %I TO accuqual_app USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- roles: the small list of system roles (admin, ...). Readable by the app role, written only on the owner connection.
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS roles_read_all ON roles;
CREATE POLICY roles_read_all ON roles
  FOR SELECT
  TO accuqual_app
  USING (true);

-- Credential tables: only ever touched by the sign-in / refresh / reset code on the owner connection. An explicit
-- deny-all policy records that intent and keeps "every RLS table has a policy" honest.
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_only ON refresh_tokens;
CREATE POLICY owner_only ON refresh_tokens
  USING (false)
  WITH CHECK (false);
ALTER TABLE mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_only ON mfa_recovery_codes;
CREATE POLICY owner_only ON mfa_recovery_codes
  USING (false)
  WITH CHECK (false);
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_only ON password_reset_tokens;
CREATE POLICY owner_only ON password_reset_tokens
  USING (false)
  WITH CHECK (false);

-- The "supplier" role (external supplier-portal logins) is reference data the app role cannot create (roles is
-- read-only to it), so it is created here, idempotently, on every migrate.
INSERT INTO roles (name, description)
VALUES ('supplier', 'External supplier portal access')
ON CONFLICT (name) DO NOTHING;
