-- Row-Level Security for every tenant-owned table.
--
-- AccuQual's multi-tenant isolation has two real layers:
--   1. Every query in the app explicitly filters by `tenantId` (see
--      src/lib/tenantScope.ts + every module's controller/service) — the
--      primary, always-active guarantee, independent of the DB role.
--   2. RLS policies below, now actually enforced: the app's per-request
--      transaction runs `SET LOCAL ROLE accuqual_app` (see tenantScope.ts's
--      withTenantDb) before touching any tenant table. `accuqual_app` is a
--      real, non-owner, non-superuser role with no BYPASSRLS attribute, so
--      Postgres actually applies these policies to it — unlike the
--      connection's own login role (whatever it's named locally or in CI),
--      which stays the table owner/superuser for migrations, extension
--      creation, and platform-admin's intentionally cross-tenant queries
--      (see modules/platform), and is *never* used directly for a
--      per-tenant request.
--
-- This is deliberately a role-SWITCH (SET LOCAL ROLE), not a second
-- connection/password/pool: accuqual_app is NOLOGIN (nobody connects as it
-- directly), and whatever role this script runs as (granted membership
-- below) can switch into it for the lifetime of one transaction. No new
-- secret, connection string, or pool to manage anywhere, and it works
-- identically in local dev, CI, and production without hardcoding a
-- per-environment role name.
--
-- Run automatically by `npm run db:migrate` (see src/db/migrate.ts). Safe to
-- re-run — every statement here, including the role creation, is idempotent.
-- Requires the connecting role to have CREATEROLE (true of a normal Postgres
-- superuser, and of most managed-Postgres "admin" login roles).

DO $$
DECLARE
  owner_role text := current_user;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'accuqual_app') THEN
    EXECUTE 'CREATE ROLE accuqual_app NOLOGIN NOSUPERUSER NOBYPASSRLS';
  END IF;

  -- Lets the connecting role SET ROLE into accuqual_app. Re-granting an
  -- already-held membership is a no-op, not an error.
  EXECUTE format('GRANT accuqual_app TO %I', owner_role);

  EXECUTE 'GRANT USAGE ON SCHEMA public TO accuqual_app';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO accuqual_app';
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO accuqual_app';

  -- So a table/sequence a *future* migration adds (owned by owner_role, same
  -- as every existing one) is automatically granted to accuqual_app too —
  -- nobody has to remember to touch this file again after adding a module.
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO accuqual_app', owner_role);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO accuqual_app', owner_role);
END $$;

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'users', 'documents', 'document_versions', 'document_folders', 'ncr', 'ncr_attachments',
    'capa', 'eight_d', 'audits', 'audit_items', 'training_courses',
    'training_assignments', 'change_requests', 'risk_assessments', 'fmea_items', 'risk_mitigations',
    'ppap_packages', 'discrepancy_investigations', 'suppliers', 'supplier_scorecards', 'equipment', 'calibrations', 'complaints',
    'workflow_definitions', 'workflow_runs', 'ai_suggestions', 'ai_risk_scores',
    'ai_embeddings', 'digital_twin_models', 'digital_twin_simulations',
    'iot_data', 'iot_devices', 'audit_trail', 'form_templates', 'form_data',
    'form_versions', 'inventory_items', 'inventory_stock', 'inventory_movements',
    'inventory_alerts', 'notification_log', 'inventory_reorder_requests',
    'erp_purchase_orders', 'erp_po_line_items', 'erp_receiving_documents', 'erp_receiving_line_items',
    'rma', 'rma_items', 'nav_hidden_items', 'work_orders', 'erp_purchase_requisitions',
    'onboarding_progress', 'feasibility_reviews',
    'sales_accounts', 'sales_activities', 'sales_quotes', 'sales_contracts',
    'customers', 'work_order_operations',
    'document_change_requests', 'document_change_items', 'document_change_reviews',
    'qms_forms', 'qms_form_rows',
    'scar_forms', 'quality_inspection_reports', 'quality_inspection_items',
    'attachments',
    'warranty_claims', 'warranty_claim_costs', 'warranty_claim_workflow',
    'supplier_onboarding_documents', 'supplier_documents', 'supplier_ppap_submissions',
    'supplier_corrective_actions', 'supplier_8d_responses', 'supplier_messages',
    'crar', 'supplier_rma_requests', 'rma_activity_log', 'rma_log',
    'permission_roles', 'permission_role_modules', 'user_permission_roles', 'department_permissions',
    'report_schedules', 'supplier_quality_risk_scores', 'inventory_lots',
    'customer_communications', 'customer_scorecards', 'erp_connector_presets',
    'erp_sync_errors', 'audit_row_changes',
    'sso_connections', 'sso_domains', 'user_identities', 'controlled_versions'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = current_setting(''app.current_tenant_id'', true)::int)
         WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true)::int)',
      t
    );
  END LOOP;
END $$;

-- erp_connector_presets is the one table above with a legitimately nullable
-- tenant_id: most rows are tenant-owned, but a real subset are global/
-- AccuQual-provided starter presets (tenant_id NULL, seeded by
-- db/seedErpPresets.ts running as the unrestricted owner role outside RLS,
-- never by app code under accuqual_app). tenant_isolation's plain equality
-- check above would make NULL rows invisible to every tenant, since
-- `NULL = current_tenant_id` is never true. This SECOND, additive
-- PERMISSIVE policy (Postgres OR's multiple permissive policies of the same
-- command together) lets every tenant also SELECT the global rows, without
-- ever allowing accuqual_app to WRITE one: it's scoped to SELECT only, so
-- INSERT/UPDATE/DELETE still only has tenant_isolation's own WITH CHECK
-- (tenant_id = current_tenant_id) to satisfy — an app-level attempt to
-- create or repoint a row to tenant_id NULL is still rejected.
DROP POLICY IF EXISTS erp_presets_global_read ON erp_connector_presets;
CREATE POLICY erp_presets_global_read ON erp_connector_presets
  FOR SELECT
  USING (tenant_id IS NULL);

-- The four public tables with NO tenant_id column, so none of them is in the
-- tenant_tables array above. They still need explicit RLS, because Supabase
-- runs an `ensure_rls` event trigger that switches RLS ON for every table a
-- migration creates — and RLS-on with zero policies means the app's
-- accuqual_app role sees NO rows. That silently broke everything reading
-- `tenants` through the tenant-scoped connection on Supabase (branding, AI
-- config/usage, profile, ERP sync settings: all "Tenant not found"; a
-- tenant's own BYOK key and AI limit were skipped) while plain Postgres in
-- local/CI, which has no such trigger, kept working — so tests never saw it.
-- Enabling RLS here (idempotent) makes every environment behave the same,
-- and rls-live-coverage.test.ts now fails on any RLS table left policy-less.

-- tenants: a request may read and update ONLY its own tenant's row. No
-- INSERT/DELETE policy on purpose — tenants are created/removed by the
-- platform (owner connection, outside RLS), never by a tenant-scoped session.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_self_select ON tenants;
CREATE POLICY tenant_self_select ON tenants
  FOR SELECT
  USING (id = current_setting('app.current_tenant_id', true)::int);
DROP POLICY IF EXISTS tenant_self_update ON tenants;
CREATE POLICY tenant_self_update ON tenants
  FOR UPDATE
  USING (id = current_setting('app.current_tenant_id', true)::int)
  WITH CHECK (id = current_setting('app.current_tenant_id', true)::int);

-- roles: the small global list of system roles (admin, ...) — not tenant
-- data, and every tenant's users reference the same rows, so it is readable
-- by any session. Read-only: the app writes roles only on the owner connection.
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS roles_read_all ON roles;
CREATE POLICY roles_read_all ON roles
  FOR SELECT
  USING (true);

-- Auth token tables: only ever touched by the login/refresh/reset code on the
-- owner connection, before any tenant context exists. An explicit deny-all
-- policy (rather than none) records that intent and keeps the "every RLS table
-- has a policy" check honest.
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

-- The "supplier" role (external supplier-portal logins) is reference data the
-- tenant-scoped app role can no longer create — roles is read-only to it (see
-- roles_read_all above) — so it is created here, idempotently, on every
-- migrate. supplier.controller.ts's ensureSupplierRole only reads it.
INSERT INTO roles (name, description)
VALUES ('supplier', 'External supplier portal access')
ON CONFLICT (name) DO NOTHING;
