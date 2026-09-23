-- Tamper-resistant, field-level audit trail. Idempotent; run by db:migrate
-- AFTER rls-policies.sql (it revokes privileges that script's blanket GRANT
-- hands to accuqual_app, so the order matters).
--
-- Two layers, deliberately separate:
--   * audit_trail       — the app's own event log ("who did what": status
--                         changes, approvals, decisions). Written by app code.
--   * audit_row_changes — this file: WHAT changed, field by field, old -> new,
--                         written by a database trigger so no code path (or
--                         forgotten call site) can skip it, and readable but
--                         never writable by the tenant-scoped app role.
-- Both carry the Postgres transaction id, which is how a history entry finds
-- its field changes.

CREATE OR REPLACE FUNCTION audit_row_change() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER            -- runs as the table owner, so the app role needs NO insert privilege on audit_row_changes
SET search_path = public, pg_temp
AS $$
DECLARE
  old_j jsonb;
  new_j jsonb;
  base_j jsonb;
  diff jsonb := '{}'::jsonb;
  entry jsonb;
  k text;
  ov jsonb;
  nv jsonb;
  tenant int;
  rid int;
  actor int;
  -- Columns never worth logging: timestamps that change on every write, plus
  -- whatever this table's trigger was created with (noisy counters, secret blobs).
  skip text[] := ARRAY['updated_at', 'created_at'] || COALESCE(TG_ARGV, ARRAY[]::text[]);
  -- Anything that looks like a credential is recorded as "[redacted]" — the fact
  -- that it changed is auditable, its value never lands in the log.
  secret_pattern constant text := '(password|passwd|secret|token|api_?key|encrypted|ciphertext|credential|hash|jwt)';
BEGIN
  IF TG_OP = 'DELETE' THEN
    old_j := to_jsonb(OLD);
    base_j := old_j;
  ELSIF TG_OP = 'INSERT' THEN
    new_j := to_jsonb(NEW);
    base_j := new_j;
  ELSE
    old_j := to_jsonb(OLD);
    new_j := to_jsonb(NEW);
    base_j := new_j;
  END IF;

  IF TG_TABLE_NAME = 'tenants' THEN
    tenant := (base_j ->> 'id')::int;
  ELSE
    tenant := (base_j ->> 'tenant_id')::int;
  END IF;
  IF tenant IS NULL THEN
    RETURN NULL; -- cannot be attributed to a tenant
  END IF;
  rid := (base_j ->> 'id')::int;

  FOR k IN SELECT jsonb_object_keys(base_j) LOOP
    CONTINUE WHEN k = ANY (skip);
    ov := old_j -> k;
    nv := new_j -> k;

    IF TG_OP = 'UPDATE' AND ov IS NOT DISTINCT FROM nv THEN CONTINUE; END IF;
    IF TG_OP = 'INSERT' AND (nv IS NULL OR nv = 'null'::jsonb) THEN CONTINUE; END IF;
    IF TG_OP = 'DELETE' AND (ov IS NULL OR ov = 'null'::jsonb) THEN CONTINUE; END IF;

    IF k ~* secret_pattern THEN
      IF ov IS NOT NULL AND ov <> 'null'::jsonb THEN ov := to_jsonb('[redacted]'::text); END IF;
      IF nv IS NOT NULL AND nv <> 'null'::jsonb THEN nv := to_jsonb('[redacted]'::text); END IF;
    ELSE
      IF length(ov::text) > 2000 THEN ov := to_jsonb('[large value: ' || length(ov::text) || ' chars]'); END IF;
      IF length(nv::text) > 2000 THEN nv := to_jsonb('[large value: ' || length(nv::text) || ' chars]'); END IF;
    END IF;

    entry := '{}'::jsonb;
    IF TG_OP IN ('UPDATE', 'DELETE') THEN entry := entry || jsonb_build_object('from', ov); END IF;
    IF TG_OP IN ('UPDATE', 'INSERT') THEN entry := entry || jsonb_build_object('to', nv); END IF;
    diff := diff || jsonb_build_object(k, entry);
  END LOOP;

  IF diff = '{}'::jsonb THEN
    RETURN NULL; -- only skipped columns changed
  END IF;

  actor := NULLIF(current_setting('app.current_user_id', true), '')::int;
  INSERT INTO audit_row_changes (tenant_id, table_name, row_id, op, changes, actor_user_id, txid)
  VALUES (tenant, TG_TABLE_NAME, rid, TG_OP, diff, actor, txid_current());
  RETURN NULL;
END;
$$;

-- Which tables get the trigger, and the columns to leave out of each one's diff.
-- Deliberately the quality/admin records an auditor asks about; high-volume or
-- machine-written tables (form autosaves, IoT readings, notifications, AI
-- vectors, inventory movements) are left out on purpose.
DO $$
DECLARE
  spec record;
  arglist text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('users',                       ARRAY['last_login_at', 'theme_preferences', 'failed_login_count', 'first_failed_login_at', 'mfa_last_used_step']),
      ('sites',                       ARRAY[]::text[]),
      ('user_sites',                  ARRAY[]::text[]),
      ('tenants',                     ARRAY['ai_config', 'erp_sync_settings', 'ai_usage_tokens', 'ai_usage_cost']),
      ('department_permissions',      ARRAY[]::text[]),
      ('permission_roles',            ARRAY[]::text[]),
      ('permission_role_modules',     ARRAY[]::text[]),
      ('user_permission_roles',       ARRAY[]::text[]),
      ('ncr',                         ARRAY[]::text[]),
      ('capa',                        ARRAY[]::text[]),
      ('eight_d',                     ARRAY[]::text[]),
      ('audits',                      ARRAY[]::text[]),
      ('audit_items',                 ARRAY[]::text[]),
      ('training_courses',            ARRAY[]::text[]),
      ('training_assignments',        ARRAY[]::text[]),
      ('change_requests',             ARRAY[]::text[]),
      ('risk_assessments',            ARRAY[]::text[]),
      ('fmea_items',                  ARRAY[]::text[]),
      ('risk_mitigations',            ARRAY[]::text[]),
      ('ppap_packages',               ARRAY[]::text[]),
      ('discrepancy_investigations',  ARRAY[]::text[]),
      ('complaints',                  ARRAY[]::text[]),
      ('suppliers',                   ARRAY[]::text[]),
      ('supplier_scorecards',         ARRAY[]::text[]),
      ('supplier_corrective_actions', ARRAY[]::text[]),
      ('supplier_8d_responses',       ARRAY[]::text[]),
      ('supplier_ppap_submissions',   ARRAY[]::text[]),
      ('equipment',                   ARRAY[]::text[]),
      ('calibrations',                ARRAY[]::text[]),
      ('documents',                   ARRAY[]::text[]),
      ('document_versions',           ARRAY[]::text[]),
      ('document_files',              ARRAY[]::text[]),
      ('quarantine_records',          ARRAY[]::text[]),
      ('quarantine_inventory',        ARRAY[]::text[]),
      ('quarantine_resolutions',      ARRAY[]::text[]),
      ('training_sessions',           ARRAY[]::text[]),
      ('training_competencies',       ARRAY[]::text[]),
      ('document_change_requests',    ARRAY[]::text[]),
      ('document_change_items',       ARRAY[]::text[]),
      ('document_change_reviews',     ARRAY[]::text[]),
      ('workflow_definitions',        ARRAY[]::text[]),
      ('qms_forms',                   ARRAY[]::text[]),
      ('scar_forms',                  ARRAY[]::text[]),
      ('quality_inspection_reports',  ARRAY[]::text[]),
      ('quality_inspection_items',    ARRAY[]::text[]),
      ('warranty_claims',             ARRAY[]::text[]),
      ('warranty_claim_costs',        ARRAY[]::text[]),
      ('crar',                        ARRAY[]::text[]),
      ('rma',                         ARRAY[]::text[]),
      ('rma_items',                   ARRAY[]::text[]),
      ('rma_log',                     ARRAY[]::text[]),
      ('work_orders',                 ARRAY[]::text[]),
      ('work_order_operations',       ARRAY[]::text[]),
      ('customers',                   ARRAY[]::text[]),
      ('feasibility_reviews',         ARRAY[]::text[]),
      ('erp_purchase_orders',         ARRAY[]::text[]),
      ('erp_po_line_items',           ARRAY[]::text[]),
      ('erp_receiving_documents',     ARRAY[]::text[]),
      ('erp_receiving_line_items',    ARRAY[]::text[]),
      ('erp_purchase_requisitions',   ARRAY[]::text[]),
      ('erp_connector_presets',       ARRAY[]::text[]),
      ('inventory_items',             ARRAY[]::text[]),
      ('inventory_lots',              ARRAY[]::text[]),
      ('attachments',                 ARRAY[]::text[]),
      ('iot_devices',                 ARRAY['last_seen_at']),
      ('sales_accounts',              ARRAY[]::text[]),
      ('sales_quotes',                ARRAY[]::text[]),
      ('sales_contracts',             ARRAY[]::text[]),
      ('sso_connections',             ARRAY[]::text[]),
      ('sso_domains',                 ARRAY[]::text[]),
      ('user_identities',             ARRAY['last_login_at']),
      ('controlled_versions',         ARRAY['payload'])
    ) AS s(tbl, excluded)
  LOOP
    CONTINUE WHEN to_regclass('public.' || spec.tbl) IS NULL;
    SELECT COALESCE(string_agg(quote_literal(x), ', '), '') INTO arglist FROM unnest(spec.excluded) AS x;
    EXECUTE format('DROP TRIGGER IF EXISTS audit_row_change ON %I', spec.tbl);
    EXECUTE format('CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row_change(%s)', spec.tbl, arglist);
  END LOOP;
END $$;

-- Append-only for the tenant-scoped app role.
--
-- audit_trail: it may read its tenant's rows and add new ones — never rewrite
-- or remove history. (rls-policies.sql just GRANTed it UPDATE/DELETE like every
-- other table, and gave it one FOR ALL policy; both are replaced here.)
REVOKE UPDATE, DELETE, TRUNCATE ON audit_trail FROM accuqual_app;
DROP POLICY IF EXISTS tenant_isolation ON audit_trail;
DROP POLICY IF EXISTS audit_trail_read ON audit_trail;
CREATE POLICY audit_trail_read ON audit_trail
  FOR SELECT
  USING (tenant_id = current_setting('app.current_tenant_id', true)::int);
DROP POLICY IF EXISTS audit_trail_append ON audit_trail;
CREATE POLICY audit_trail_append ON audit_trail
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::int);

-- audit_row_changes: read-only. Rows arrive only through the SECURITY DEFINER
-- trigger above, so the app role gets no write privilege of any kind.
REVOKE ALL ON audit_row_changes FROM accuqual_app;
GRANT SELECT ON audit_row_changes TO accuqual_app;
DROP POLICY IF EXISTS tenant_isolation ON audit_row_changes;
DROP POLICY IF EXISTS audit_row_changes_read ON audit_row_changes;
CREATE POLICY audit_row_changes_read ON audit_row_changes
  FOR SELECT
  USING (tenant_id = current_setting('app.current_tenant_id', true)::int);
