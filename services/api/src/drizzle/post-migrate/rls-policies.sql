-- Row-Level Security for every tenant-owned table.
--
-- AccuQual's multi-tenant isolation has two layers:
--   1. Every query in the app explicitly filters by `tenantId` (see
--      src/lib/tenantScope.ts + every module's controller/service) — this is
--      the primary, always-active guarantee and works regardless of which
--      DB role the app connects as.
--   2. These RLS policies are a second, DB-level layer that only actually
--      restricts a role that is NOT the table owner (Postgres exempts table
--      owners from RLS by default, and this migration does not use
--      `FORCE ROW LEVEL SECURITY`, on purpose — see the role note below).
--
-- Run automatically by `npm run db:migrate` (see src/db/migrate.ts). Safe to
-- re-run — every statement is idempotent.
--
-- IMPORTANT — for layer 2 to actually do anything, the app's runtime
-- DATABASE_URL must connect as a role that is NOT the table owner (the owner
-- bypasses RLS entirely, by Postgres design). The default local/dev
-- DATABASE_URL connects as the owning role for simplicity, so RLS is present
-- but not exercised locally — that's a known, documented gap (see README).
-- In production, create and connect as a restricted role, e.g.:
--
--   CREATE ROLE accuqual_app LOGIN PASSWORD '...';
--   GRANT CONNECT ON DATABASE accuqual TO accuqual_app;
--   GRANT USAGE ON SCHEMA public TO accuqual_app;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO accuqual_app;
--   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO accuqual_app;
--
-- Platform-admin operations (creating tenants, managing platform users with
-- tenant_id IS NULL — see modules/platform) are inherently cross-tenant, so
-- they deliberately use the unscoped `db` singleton (which the pool connects
-- as the owning/admin role) rather than the per-request tenant-scoped `req.db`.

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'users', 'documents', 'document_versions', 'document_folders', 'ncr', 'ncr_attachments',
    'capa', 'eight_d', 'audits', 'audit_items', 'training_courses',
    'training_assignments', 'change_requests', 'risk_assessments', 'fmea_items',
    'ppap_packages', 'discrepancy_investigations', 'suppliers', 'supplier_scorecards', 'equipment', 'calibrations', 'complaints',
    'workflow_definitions', 'workflow_runs', 'ai_suggestions', 'ai_risk_scores',
    'ai_embeddings', 'digital_twin_models', 'digital_twin_simulations',
    'iot_data', 'iot_devices', 'audit_trail', 'form_templates', 'form_data',
    'form_versions'
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
