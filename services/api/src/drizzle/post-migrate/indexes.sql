-- Missing indexes (Inspection Report DAT-02 / PERF-01 / R03).
--
-- drizzle-kit's generated migrations never added an index beyond the one
-- PK-backed uniqueness constraint on nav_hidden_items — every tenant-scoped
-- query (which is every query in this app; see rls-policies.sql) has been a
-- full sequential scan filtered by tenant_id. Harmless at today's near-zero
-- row counts, a real cliff the moment any tenant's data grows.
--
-- Deliberately a hand-written, idempotent SQL file run by src/db/migrate.ts
-- right after rls-policies.sql, not a drizzle-kit-generated migration — same
-- reasoning as RLS itself: an index isn't part of the typed schema surface
-- the app queries through (Postgres's planner uses it automatically), so it
-- doesn't need drizzle-kit to know about it, and CREATE INDEX IF NOT EXISTS
-- is trivially safe to re-run on every deploy the same way the RLS policy
-- loop already is.
--
-- One plain btree(tenant_id) per tenant-scoped table (the shape every single
-- query in the app already filters on), plus a composite (tenant_id, status)
-- on the handful of tables list pages routinely filter by both, plus the one
-- composite audit_trail actually needs for its real query shape (see
-- workflow.controller.ts's historyHandler and audit-trail.routes.ts).

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
    'form_versions', 'inventory_items', 'inventory_stock', 'inventory_movements',
    'inventory_alerts', 'notification_log', 'inventory_reorder_requests',
    'erp_purchase_orders', 'erp_po_line_items', 'erp_receiving_documents', 'erp_receiving_line_items',
    'rma', 'rma_items', 'work_orders', 'erp_purchase_requisitions', 'onboarding_progress', 'risk_mitigations',
    'feasibility_reviews',
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
    -- Real gap found verifying Full-System Audit finding H5 against the
    -- live database directly (the audit's own named examples turned out to
    -- already be indexed — these 4 were the genuine miss): added after
    -- this array was last touched, one per feature that shipped later
    -- (Customer Communications Log, Customer Scorecard, Phase 8's
    -- inventory_lots ledger, Phase 6's report_schedules).
    'customer_communications', 'customer_scorecards', 'inventory_lots', 'report_schedules',
    'erp_connector_presets'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (tenant_id)', t || '_tenant_id_idx', t);
  END LOOP;
END $$;

-- Composite (tenant_id, status) — every list page filters by both together.
CREATE INDEX IF NOT EXISTS ncr_tenant_status_idx ON ncr (tenant_id, status);
CREATE INDEX IF NOT EXISTS capa_tenant_status_idx ON capa (tenant_id, status);
CREATE INDEX IF NOT EXISTS audits_tenant_status_idx ON audits (tenant_id, status);
CREATE INDEX IF NOT EXISTS suppliers_tenant_status_idx ON suppliers (tenant_id, status);
CREATE INDEX IF NOT EXISTS training_assignments_tenant_status_idx ON training_assignments (tenant_id, status);
CREATE INDEX IF NOT EXISTS erp_purchase_orders_tenant_status_idx ON erp_purchase_orders (tenant_id, status);
CREATE INDEX IF NOT EXISTS inventory_reorder_requests_tenant_status_idx ON inventory_reorder_requests (tenant_id, status);
CREATE INDEX IF NOT EXISTS rma_tenant_status_idx ON rma (tenant_id, status);
CREATE INDEX IF NOT EXISTS work_orders_tenant_status_idx ON work_orders (tenant_id, status);
CREATE INDEX IF NOT EXISTS erp_purchase_requisitions_tenant_status_idx ON erp_purchase_requisitions (tenant_id, status);
CREATE INDEX IF NOT EXISTS risk_assessments_tenant_status_idx ON risk_assessments (tenant_id, status);
CREATE INDEX IF NOT EXISTS feasibility_reviews_tenant_status_idx ON feasibility_reviews (tenant_id, status);
CREATE INDEX IF NOT EXISTS sales_accounts_tenant_status_idx ON sales_accounts (tenant_id, status);
CREATE INDEX IF NOT EXISTS sales_quotes_tenant_status_idx ON sales_quotes (tenant_id, status);
CREATE INDEX IF NOT EXISTS sales_contracts_tenant_status_idx ON sales_contracts (tenant_id, status);
CREATE INDEX IF NOT EXISTS customers_tenant_status_idx ON customers (tenant_id, status);
CREATE INDEX IF NOT EXISTS warranty_claims_tenant_status_idx ON warranty_claims (tenant_id, status);
CREATE INDEX IF NOT EXISTS crar_tenant_status_idx ON crar (tenant_id, status);
CREATE INDEX IF NOT EXISTS supplier_rma_requests_tenant_status_idx ON supplier_rma_requests (tenant_id, status);
CREATE INDEX IF NOT EXISTS rma_log_tenant_status_idx ON rma_log (tenant_id, status);

-- The single hottest lookup shape in the whole app: every module's history
-- panel (WorkflowHistoryPanel) and the generic per-entity audit endpoint
-- both query audit_trail by exactly these three columns together.
CREATE INDEX IF NOT EXISTS audit_trail_entity_lookup_idx ON audit_trail (tenant_id, entity_type, entity_id);

-- Common FK join targets worth a plain index beyond what the FK constraint
-- itself provides (Postgres does NOT automatically index the referencing
-- side of a foreign key).
CREATE INDEX IF NOT EXISTS inventory_stock_item_idx ON inventory_stock (item_id);
CREATE INDEX IF NOT EXISTS inventory_movements_item_idx ON inventory_movements (item_id);
CREATE INDEX IF NOT EXISTS inventory_alerts_item_idx ON inventory_alerts (item_id);
CREATE INDEX IF NOT EXISTS erp_po_line_items_po_idx ON erp_po_line_items (purchase_order_id);
CREATE INDEX IF NOT EXISTS erp_receiving_line_items_doc_idx ON erp_receiving_line_items (receiving_document_id);
CREATE INDEX IF NOT EXISTS rma_items_rma_idx ON rma_items (rma_id);
CREATE INDEX IF NOT EXISTS capa_ncr_idx ON capa (ncr_id);
CREATE INDEX IF NOT EXISTS work_orders_item_idx ON work_orders (item_id);
CREATE INDEX IF NOT EXISTS erp_purchase_requisitions_item_idx ON erp_purchase_requisitions (item_id);
CREATE INDEX IF NOT EXISTS onboarding_progress_user_idx ON onboarding_progress (user_id);
CREATE INDEX IF NOT EXISTS fmea_items_risk_idx ON fmea_items (risk_assessment_id);
CREATE INDEX IF NOT EXISTS risk_mitigations_risk_idx ON risk_mitigations (risk_assessment_id);
CREATE INDEX IF NOT EXISTS feasibility_reviews_customer_idx ON feasibility_reviews (customer_id);
CREATE INDEX IF NOT EXISTS sales_activities_account_idx ON sales_activities (account_id);
CREATE INDEX IF NOT EXISTS sales_quotes_account_idx ON sales_quotes (account_id);
CREATE INDEX IF NOT EXISTS sales_contracts_account_idx ON sales_contracts (account_id);
CREATE INDEX IF NOT EXISTS customers_related_source_idx ON customers (related_source_type, related_source_id);
CREATE INDEX IF NOT EXISTS work_order_operations_wo_idx ON work_order_operations (work_order_id);
CREATE INDEX IF NOT EXISTS document_change_items_dcr_idx ON document_change_items (document_change_request_id);
CREATE INDEX IF NOT EXISTS document_change_reviews_dcr_idx ON document_change_reviews (document_change_request_id);
CREATE INDEX IF NOT EXISTS qms_forms_type_idx ON qms_forms (tenant_id, form_type);
CREATE INDEX IF NOT EXISTS qms_form_rows_form_idx ON qms_form_rows (form_id);
CREATE INDEX IF NOT EXISTS quality_inspection_items_report_idx ON quality_inspection_items (report_id);
-- The hot lookup shape for the generic attachments panel embedded on every
-- record's own page: "every attachment for this one record", or (both null)
-- the shared General Uploads bin.
CREATE INDEX IF NOT EXISTS attachments_entity_idx ON attachments (tenant_id, entity_type, entity_id);

-- Warranty + Supplier Portal's own hot lookup shapes: everything under a
-- given claim/supplier, in creation order.
CREATE INDEX IF NOT EXISTS warranty_claim_costs_claim_idx ON warranty_claim_costs (claim_id);
CREATE INDEX IF NOT EXISTS warranty_claim_workflow_claim_idx ON warranty_claim_workflow (claim_id);
CREATE INDEX IF NOT EXISTS supplier_onboarding_documents_supplier_idx ON supplier_onboarding_documents (tenant_id, supplier_id);
CREATE INDEX IF NOT EXISTS supplier_documents_supplier_idx ON supplier_documents (tenant_id, supplier_id);
CREATE INDEX IF NOT EXISTS supplier_ppap_submissions_supplier_idx ON supplier_ppap_submissions (tenant_id, supplier_id);
CREATE INDEX IF NOT EXISTS supplier_corrective_actions_supplier_idx ON supplier_corrective_actions (tenant_id, supplier_id);
CREATE INDEX IF NOT EXISTS supplier_8d_responses_supplier_idx ON supplier_8d_responses (tenant_id, supplier_id);
CREATE INDEX IF NOT EXISTS supplier_messages_thread_idx ON supplier_messages (tenant_id, supplier_id, thread_key);
CREATE INDEX IF NOT EXISTS supplier_rma_requests_supplier_idx ON supplier_rma_requests (tenant_id, supplier_id);
CREATE INDEX IF NOT EXISTS rma_activity_log_rma_idx ON rma_activity_log (tenant_id, rma_id);
CREATE INDEX IF NOT EXISTS crar_warranty_idx ON crar (warranty_id);

-- The RMA Log register's own linkage lookups (module-specific RBAC build,
-- 2026-09-16) — same "one index per real FK a page actually queries by"
-- convention as crar_warranty_idx above.
CREATE INDEX IF NOT EXISTS rma_log_warranty_idx ON rma_log (warranty_id);
CREATE INDEX IF NOT EXISTS rma_log_supplier_request_idx ON rma_log (supplier_rma_request_id);
CREATE INDEX IF NOT EXISTS rma_log_quality_idx ON rma_log (quality_id);

-- Roles & Permissions' own hot lookup shape: getUserAccessLevel() runs on
-- EVERY protected request now, so its user_permission_roles ->
-- permission_role_modules join (departmentAccess.ts's getRoleGrantedAccessLevel)
-- deserves its own index beyond the composite unique constraints already on
-- each table (those lead with tenant_id + a different second column each).
CREATE INDEX IF NOT EXISTS user_permission_roles_user_idx ON user_permission_roles (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS permission_role_modules_role_idx ON permission_role_modules (role_id, module_name);

-- password_reset_tokens isn't in the tenant_tables array above (see its own
-- schema comment — it's only ever queried via the unscoped db, pre-auth,
-- same as users/roles/tenants), but its actual lookup shape still needs a
-- real index: reset-password looks it up by token_hash, forgot-password's
-- rate-limiting/cleanup looks it up by user_id.
CREATE INDEX IF NOT EXISTS password_reset_tokens_hash_idx ON password_reset_tokens (token_hash);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON password_reset_tokens (user_id);
