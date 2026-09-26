-- Single-company conversion. This installation belongs to exactly one company, so the per-company scoping goes away:
-- every tenant_id column, the tenants table becomes the one-row company table, billing tables go, and so does the
-- platform-administrator concept. Existing data is kept.

-- Refuse to run when there is more than one company: their rows would silently merge into one.
DO $$
BEGIN
  IF (SELECT count(*) FROM tenants) > 1 THEN
    RAISE EXCEPTION 'Single-company conversion needs exactly one company, but found % tenants. Remove the extra ones first.', (SELECT count(*) FROM tenants);
  END IF;
END $$;
--> statement-breakpoint

-- The old row-level-security policies all compare tenant_id; they must go before that column can.
-- (post-migrate/rls-policies.sql recreates a simple policy per table right after this migration.)
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END $$;
--> statement-breakpoint

-- There is no platform administrator any more. Take the old account out if nothing references it,
-- otherwise leave it switched off.
DO $$
DECLARE
  admin_role int;
  u record;
BEGIN
  SELECT id INTO admin_role FROM roles WHERE name = 'platform_admin';
  IF admin_role IS NULL THEN RETURN; END IF;
  FOR u IN SELECT id FROM users WHERE role_id = admin_role LOOP
    BEGIN
      DELETE FROM refresh_tokens WHERE user_id = u.id;
      DELETE FROM password_reset_tokens WHERE user_id = u.id;
      DELETE FROM mfa_recovery_codes WHERE user_id = u.id;
      DELETE FROM users WHERE id = u.id;
    EXCEPTION WHEN foreign_key_violation THEN
      UPDATE users SET is_active = false, token_version = token_version + 1 WHERE id = u.id;
    END;
  END LOOP;
  BEGIN
    DELETE FROM roles WHERE id = admin_role;
  EXCEPTION WHEN foreign_key_violation THEN
    NULL; -- a deactivated account still points at it
  END;
END $$;
--> statement-breakpoint

ALTER TABLE "billing_events" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_subscriptions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "billing_events" CASCADE;--> statement-breakpoint
DROP TABLE "tenant_subscriptions" CASCADE;--> statement-breakpoint
ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_code_unique";--> statement-breakpoint
ALTER TABLE "iot_devices" DROP CONSTRAINT IF EXISTS "iot_devices_tenant_device_unique";--> statement-breakpoint
ALTER TABLE "worker_profiles" DROP CONSTRAINT IF EXISTS "worker_profiles_tenant_user_unique";--> statement-breakpoint
ALTER TABLE "sso_connections" DROP CONSTRAINT IF EXISTS "sso_connections_tenant_id_unique";--> statement-breakpoint
ALTER TABLE "sso_domains" DROP CONSTRAINT IF EXISTS "sso_domains_tenant_domain_uq";--> statement-breakpoint
ALTER TABLE "controlled_versions" DROP CONSTRAINT IF EXISTS "controlled_versions_subject_number_uq";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "sites" DROP CONSTRAINT IF EXISTS "sites_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "user_sites" DROP CONSTRAINT IF EXISTS "user_sites_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "document_files" DROP CONSTRAINT IF EXISTS "document_files_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "document_versions" DROP CONSTRAINT IF EXISTS "document_versions_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "ncr" DROP CONSTRAINT IF EXISTS "ncr_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "ncr_attachments" DROP CONSTRAINT IF EXISTS "ncr_attachments_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "capa" DROP CONSTRAINT IF EXISTS "capa_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "eight_d" DROP CONSTRAINT IF EXISTS "eight_d_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_items" DROP CONSTRAINT IF EXISTS "audit_items_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "audits" DROP CONSTRAINT IF EXISTS "audits_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "training_assignments" DROP CONSTRAINT IF EXISTS "training_assignments_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "training_competencies" DROP CONSTRAINT IF EXISTS "training_competencies_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "training_courses" DROP CONSTRAINT IF EXISTS "training_courses_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "training_sessions" DROP CONSTRAINT IF EXISTS "training_sessions_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "change_requests" DROP CONSTRAINT IF EXISTS "change_requests_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "fmea_items" DROP CONSTRAINT IF EXISTS "fmea_items_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "risk_assessments" DROP CONSTRAINT IF EXISTS "risk_assessments_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "risk_mitigations" DROP CONSTRAINT IF EXISTS "risk_mitigations_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "feasibility_reviews" DROP CONSTRAINT IF EXISTS "feasibility_reviews_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "sales_accounts" DROP CONSTRAINT IF EXISTS "sales_accounts_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "sales_activities" DROP CONSTRAINT IF EXISTS "sales_activities_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "sales_contracts" DROP CONSTRAINT IF EXISTS "sales_contracts_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "sales_quotes" DROP CONSTRAINT IF EXISTS "sales_quotes_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "ppap_packages" DROP CONSTRAINT IF EXISTS "ppap_packages_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "discrepancy_investigations" DROP CONSTRAINT IF EXISTS "discrepancy_investigations_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "document_folders" DROP CONSTRAINT IF EXISTS "document_folders_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "supplier_scorecards" DROP CONSTRAINT IF EXISTS "supplier_scorecards_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "suppliers" DROP CONSTRAINT IF EXISTS "suppliers_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "calibrations" DROP CONSTRAINT IF EXISTS "calibrations_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "equipment" DROP CONSTRAINT IF EXISTS "equipment_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "complaints" DROP CONSTRAINT IF EXISTS "complaints_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "workflow_definitions" DROP CONSTRAINT IF EXISTS "workflow_definitions_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "workflow_runs" DROP CONSTRAINT IF EXISTS "workflow_runs_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "ai_embeddings" DROP CONSTRAINT IF EXISTS "ai_embeddings_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "ai_risk_scores" DROP CONSTRAINT IF EXISTS "ai_risk_scores_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "ai_suggestions" DROP CONSTRAINT IF EXISTS "ai_suggestions_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "digital_twin_models" DROP CONSTRAINT IF EXISTS "digital_twin_models_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "digital_twin_simulations" DROP CONSTRAINT IF EXISTS "digital_twin_simulations_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "iot_data" DROP CONSTRAINT IF EXISTS "iot_data_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "iot_devices" DROP CONSTRAINT IF EXISTS "iot_devices_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_trail" DROP CONSTRAINT IF EXISTS "audit_trail_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "form_data" DROP CONSTRAINT IF EXISTS "form_data_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "form_templates" DROP CONSTRAINT IF EXISTS "form_templates_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "form_versions" DROP CONSTRAINT IF EXISTS "form_versions_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "nav_hidden_items" DROP CONSTRAINT IF EXISTS "nav_hidden_items_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "worker_profiles" DROP CONSTRAINT IF EXISTS "worker_profiles_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "inventory_alerts" DROP CONSTRAINT IF EXISTS "inventory_alerts_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "inventory_items" DROP CONSTRAINT IF EXISTS "inventory_items_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "inventory_movements" DROP CONSTRAINT IF EXISTS "inventory_movements_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "inventory_reorder_requests" DROP CONSTRAINT IF EXISTS "inventory_reorder_requests_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "inventory_stock" DROP CONSTRAINT IF EXISTS "inventory_stock_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "notification_log" DROP CONSTRAINT IF EXISTS "notification_log_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "erp_po_line_items" DROP CONSTRAINT IF EXISTS "erp_po_line_items_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "erp_purchase_orders" DROP CONSTRAINT IF EXISTS "erp_purchase_orders_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "erp_purchase_requisitions" DROP CONSTRAINT IF EXISTS "erp_purchase_requisitions_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "erp_receiving_documents" DROP CONSTRAINT IF EXISTS "erp_receiving_documents_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "erp_receiving_line_items" DROP CONSTRAINT IF EXISTS "erp_receiving_line_items_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "rma" DROP CONSTRAINT IF EXISTS "rma_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "rma_items" DROP CONSTRAINT IF EXISTS "rma_items_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "work_order_operations" DROP CONSTRAINT IF EXISTS "work_order_operations_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "work_orders" DROP CONSTRAINT IF EXISTS "work_orders_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "onboarding_progress" DROP CONSTRAINT IF EXISTS "onboarding_progress_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "customers" DROP CONSTRAINT IF EXISTS "customers_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "customer_communications" DROP CONSTRAINT IF EXISTS "customer_communications_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "customer_scorecards" DROP CONSTRAINT IF EXISTS "customer_scorecards_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "document_change_items" DROP CONSTRAINT IF EXISTS "document_change_items_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "document_change_requests" DROP CONSTRAINT IF EXISTS "document_change_requests_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "document_change_reviews" DROP CONSTRAINT IF EXISTS "document_change_reviews_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "qms_form_rows" DROP CONSTRAINT IF EXISTS "qms_form_rows_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "qms_forms" DROP CONSTRAINT IF EXISTS "qms_forms_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "scar_forms" DROP CONSTRAINT IF EXISTS "scar_forms_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "quality_inspection_items" DROP CONSTRAINT IF EXISTS "quality_inspection_items_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "quality_inspection_reports" DROP CONSTRAINT IF EXISTS "quality_inspection_reports_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT IF EXISTS "attachments_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "warranty_claim_costs" DROP CONSTRAINT IF EXISTS "warranty_claim_costs_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "warranty_claim_workflow" DROP CONSTRAINT IF EXISTS "warranty_claim_workflow_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "warranty_claims" DROP CONSTRAINT IF EXISTS "warranty_claims_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "supplier_8d_responses" DROP CONSTRAINT IF EXISTS "supplier_8d_responses_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "supplier_corrective_actions" DROP CONSTRAINT IF EXISTS "supplier_corrective_actions_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "supplier_documents" DROP CONSTRAINT IF EXISTS "supplier_documents_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "supplier_messages" DROP CONSTRAINT IF EXISTS "supplier_messages_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "supplier_onboarding_documents" DROP CONSTRAINT IF EXISTS "supplier_onboarding_documents_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "supplier_ppap_submissions" DROP CONSTRAINT IF EXISTS "supplier_ppap_submissions_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "rma_activity_log" DROP CONSTRAINT IF EXISTS "rma_activity_log_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "supplier_rma_requests" DROP CONSTRAINT IF EXISTS "supplier_rma_requests_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "crar" DROP CONSTRAINT IF EXISTS "crar_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "department_permissions" DROP CONSTRAINT IF EXISTS "department_permissions_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "permission_role_modules" DROP CONSTRAINT IF EXISTS "permission_role_modules_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "permission_roles" DROP CONSTRAINT IF EXISTS "permission_roles_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "user_permission_roles" DROP CONSTRAINT IF EXISTS "user_permission_roles_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "rma_log" DROP CONSTRAINT IF EXISTS "rma_log_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "report_schedules" DROP CONSTRAINT IF EXISTS "report_schedules_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "supplier_quality_risk_scores" DROP CONSTRAINT IF EXISTS "supplier_quality_risk_scores_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "inventory_lots" DROP CONSTRAINT IF EXISTS "inventory_lots_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "quarantine_inventory" DROP CONSTRAINT IF EXISTS "quarantine_inventory_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "quarantine_records" DROP CONSTRAINT IF EXISTS "quarantine_records_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "quarantine_resolutions" DROP CONSTRAINT IF EXISTS "quarantine_resolutions_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "erp_connector_presets" DROP CONSTRAINT IF EXISTS "erp_connector_presets_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "erp_sync_errors" DROP CONSTRAINT IF EXISTS "erp_sync_errors_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "sso_connections" DROP CONSTRAINT IF EXISTS "sso_connections_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "sso_domains" DROP CONSTRAINT IF EXISTS "sso_domains_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "user_identities" DROP CONSTRAINT IF EXISTS "user_identities_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "controlled_versions" DROP CONSTRAINT IF EXISTS "controlled_versions_tenant_id_tenants_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "sites_tenant_code_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "nav_hidden_items_tenant_scope_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "department_permissions_tenant_dept_module_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "permission_role_modules_tenant_role_module_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "permission_roles_tenant_name_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "user_permission_roles_tenant_user_role_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "rma_log_tenant_rma_number_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "audit_row_changes_row_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "audit_row_changes_tx_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "controlled_versions_one_open_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "sites_code_idx" ON "sites" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "nav_hidden_items_scope_idx" ON "nav_hidden_items" USING btree ("scope");--> statement-breakpoint
CREATE UNIQUE INDEX "department_permissions_dept_module_idx" ON "department_permissions" USING btree ("department_name","module_name");--> statement-breakpoint
CREATE UNIQUE INDEX "permission_role_modules_role_module_idx" ON "permission_role_modules" USING btree ("role_id","module_name");--> statement-breakpoint
CREATE UNIQUE INDEX "permission_roles_name_idx" ON "permission_roles" USING btree ("role_name");--> statement-breakpoint
CREATE UNIQUE INDEX "user_permission_roles_user_role_idx" ON "user_permission_roles" USING btree ("user_id","role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rma_log_rma_number_idx" ON "rma_log" USING btree ("rma_number");--> statement-breakpoint
CREATE INDEX "audit_row_changes_row_idx" ON "audit_row_changes" USING btree ("table_name","row_id");--> statement-breakpoint
CREATE INDEX "audit_row_changes_tx_idx" ON "audit_row_changes" USING btree ("txid");--> statement-breakpoint
CREATE UNIQUE INDEX "controlled_versions_one_open_uq" ON "controlled_versions" USING btree ("subject_type","subject_id") WHERE status in ('draft', 'in_review');--> statement-breakpoint
ALTER TABLE "tenants" DROP COLUMN "code";--> statement-breakpoint
ALTER TABLE "tenants" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "tenants" DROP COLUMN "is_deleted";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "sites" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "user_sites" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "document_files" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "document_versions" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "ncr" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "ncr_attachments" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "capa" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "eight_d" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "audit_items" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "audits" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "training_assignments" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "training_competencies" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "training_courses" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "training_sessions" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "change_requests" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "fmea_items" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "risk_assessments" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "risk_mitigations" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "feasibility_reviews" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "sales_accounts" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "sales_activities" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "sales_contracts" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "sales_quotes" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "ppap_packages" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "discrepancy_investigations" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "document_folders" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "supplier_scorecards" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "suppliers" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "calibrations" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "equipment" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "complaints" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "workflow_definitions" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "workflow_runs" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "ai_embeddings" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "ai_risk_scores" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "ai_suggestions" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "digital_twin_models" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "digital_twin_simulations" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "iot_data" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "iot_devices" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "audit_trail" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "form_data" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "form_templates" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "form_versions" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "nav_hidden_items" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "worker_profiles" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "inventory_alerts" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "inventory_items" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "inventory_movements" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "inventory_reorder_requests" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "inventory_stock" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "notification_log" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "erp_po_line_items" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "erp_purchase_orders" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "erp_purchase_requisitions" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "erp_receiving_documents" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "erp_receiving_line_items" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "rma" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "rma_items" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "work_order_operations" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "work_orders" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "onboarding_progress" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "customer_communications" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "customer_scorecards" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "document_change_items" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "document_change_requests" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "document_change_reviews" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "qms_form_rows" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "qms_forms" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "scar_forms" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "quality_inspection_items" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "quality_inspection_reports" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "attachments" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "warranty_claim_costs" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "warranty_claim_workflow" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "warranty_claims" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "supplier_8d_responses" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "supplier_corrective_actions" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "supplier_documents" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "supplier_messages" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "supplier_onboarding_documents" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "supplier_ppap_submissions" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "rma_activity_log" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "supplier_rma_requests" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "crar" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "department_permissions" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "permission_role_modules" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "permission_roles" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "user_permission_roles" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "rma_log" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "report_schedules" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "supplier_quality_risk_scores" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "inventory_lots" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "quarantine_inventory" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "quarantine_records" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "quarantine_resolutions" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "erp_connector_presets" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "erp_sync_errors" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "audit_row_changes" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "sso_connections" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "sso_domains" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "user_identities" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "controlled_versions" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "iot_devices" ADD CONSTRAINT "iot_devices_device_unique" UNIQUE("device_id");--> statement-breakpoint
ALTER TABLE "worker_profiles" ADD CONSTRAINT "worker_profiles_user_unique" UNIQUE("user_id");--> statement-breakpoint
ALTER TABLE "sso_domains" ADD CONSTRAINT "sso_domains_domain_uq" UNIQUE("domain");--> statement-breakpoint
ALTER TABLE "controlled_versions" ADD CONSTRAINT "controlled_versions_subject_number_uq" UNIQUE("subject_type","subject_id","version_number");
--> statement-breakpoint
ALTER TABLE "tenants" RENAME TO "company";
--> statement-breakpoint
ALTER TABLE "company" RENAME CONSTRAINT "tenants_pkey" TO "company_pkey";
--> statement-breakpoint
ALTER SEQUENCE "tenants_id_seq" RENAME TO "company_id_seq";

--> statement-breakpoint
-- The plant triggers from migration 0070 looked plants up by tenant_id. Recreate them for one company.
CREATE OR REPLACE FUNCTION accuqual_company_default_site() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO sites (name, code, status, is_default)
  VALUES ('Main plant', 'main', 'active', true)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tenants_default_site ON "company";
--> statement-breakpoint
DROP TRIGGER IF EXISTS company_default_site ON "company";
--> statement-breakpoint
CREATE TRIGGER company_default_site
AFTER INSERT ON "company"
FOR EACH ROW EXECUTE FUNCTION accuqual_company_default_site();
--> statement-breakpoint
DROP FUNCTION IF EXISTS accuqual_tenant_default_site();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION accuqual_user_default_site_before() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sid int;
BEGIN
  IF NEW.current_site_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT id INTO sid FROM sites WHERE is_default = true ORDER BY id LIMIT 1;
  IF sid IS NOT NULL THEN
    NEW.current_site_id := sid;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION accuqual_user_default_site_after() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sid int;
BEGIN
  SELECT id INTO sid FROM sites WHERE is_default = true ORDER BY id LIMIT 1;
  IF sid IS NOT NULL THEN
    INSERT INTO user_sites (user_id, site_id)
    VALUES (NEW.id, sid)
    ON CONFLICT (user_id, site_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION accuqual_fill_site_id() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.site_id IS NULL THEN
    SELECT id INTO NEW.site_id
    FROM sites
    WHERE is_default = true
    ORDER BY id
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- At most one default plant (the old index was per company).
CREATE UNIQUE INDEX IF NOT EXISTS "sites_one_default" ON "sites" ("is_default") WHERE "is_default";
