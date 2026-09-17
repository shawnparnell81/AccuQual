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
    'report_schedules', 'supplier_quality_risk_scores', 'inventory_lots'
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
