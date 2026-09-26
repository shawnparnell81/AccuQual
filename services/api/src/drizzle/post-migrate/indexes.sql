-- Extra indexes for the queries the app runs most (list pages by status/site, per-record history, foreign-key joins).
--
-- Hand-written and idempotent (CREATE INDEX IF NOT EXISTS), run by src/db/migrate.ts after the row-level-security script.
-- An index is not part of the typed schema the app queries through, so drizzle-kit does not need to know about it.

-- Status indexes — list pages filter by status.
CREATE INDEX IF NOT EXISTS ncr_status_idx ON ncr (status);
CREATE INDEX IF NOT EXISTS ncr_site_idx ON ncr (site_id);
CREATE INDEX IF NOT EXISTS capa_site_idx ON capa (site_id);
CREATE INDEX IF NOT EXISTS audits_site_idx ON audits (site_id);
CREATE INDEX IF NOT EXISTS capa_status_idx ON capa (status);
CREATE INDEX IF NOT EXISTS audits_status_idx ON audits (status);
CREATE INDEX IF NOT EXISTS suppliers_status_idx ON suppliers (status);
CREATE INDEX IF NOT EXISTS training_assignments_status_idx ON training_assignments (status);
CREATE INDEX IF NOT EXISTS erp_purchase_orders_status_idx ON erp_purchase_orders (status);
CREATE INDEX IF NOT EXISTS inventory_reorder_requests_status_idx ON inventory_reorder_requests (status);
CREATE INDEX IF NOT EXISTS rma_status_idx ON rma (status);
CREATE INDEX IF NOT EXISTS work_orders_status_idx ON work_orders (status);
CREATE INDEX IF NOT EXISTS erp_purchase_requisitions_status_idx ON erp_purchase_requisitions (status);
CREATE INDEX IF NOT EXISTS risk_assessments_status_idx ON risk_assessments (status);
CREATE INDEX IF NOT EXISTS feasibility_reviews_status_idx ON feasibility_reviews (status);
CREATE INDEX IF NOT EXISTS sales_accounts_status_idx ON sales_accounts (status);
CREATE INDEX IF NOT EXISTS sales_quotes_status_idx ON sales_quotes (status);
CREATE INDEX IF NOT EXISTS sales_contracts_status_idx ON sales_contracts (status);
CREATE INDEX IF NOT EXISTS customers_status_idx ON customers (status);
CREATE INDEX IF NOT EXISTS warranty_claims_status_idx ON warranty_claims (status);
CREATE INDEX IF NOT EXISTS crar_status_idx ON crar (status);
CREATE INDEX IF NOT EXISTS supplier_rma_requests_status_idx ON supplier_rma_requests (status);
CREATE INDEX IF NOT EXISTS rma_log_status_idx ON rma_log (status);

-- The single hottest lookup shape in the whole app: every module's history
-- panel (WorkflowHistoryPanel) and the generic per-entity audit endpoint
-- both query audit_trail by exactly these three columns together.
CREATE INDEX IF NOT EXISTS audit_trail_entity_lookup_idx ON audit_trail (entity_type, entity_id);

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
CREATE INDEX IF NOT EXISTS qms_forms_type_idx ON qms_forms (form_type);
CREATE INDEX IF NOT EXISTS qms_form_rows_form_idx ON qms_form_rows (form_id);
CREATE INDEX IF NOT EXISTS quality_inspection_items_report_idx ON quality_inspection_items (report_id);
-- The hot lookup shape for the generic attachments panel embedded on every
-- record's own page: "every attachment for this one record", or (both null)
-- the shared General Uploads bin.
CREATE INDEX IF NOT EXISTS attachments_entity_idx ON attachments (entity_type, entity_id);

-- Warranty + Supplier Portal's own hot lookup shapes: everything under a
-- given claim/supplier, in creation order.
CREATE INDEX IF NOT EXISTS warranty_claim_costs_claim_idx ON warranty_claim_costs (claim_id);
CREATE INDEX IF NOT EXISTS warranty_claim_workflow_claim_idx ON warranty_claim_workflow (claim_id);
CREATE INDEX IF NOT EXISTS supplier_onboarding_documents_supplier_idx ON supplier_onboarding_documents (supplier_id);
CREATE INDEX IF NOT EXISTS supplier_documents_supplier_idx ON supplier_documents (supplier_id);
CREATE INDEX IF NOT EXISTS supplier_ppap_submissions_supplier_idx ON supplier_ppap_submissions (supplier_id);
CREATE INDEX IF NOT EXISTS supplier_corrective_actions_supplier_idx ON supplier_corrective_actions (supplier_id);
CREATE INDEX IF NOT EXISTS supplier_8d_responses_supplier_idx ON supplier_8d_responses (supplier_id);
CREATE INDEX IF NOT EXISTS supplier_messages_thread_idx ON supplier_messages (supplier_id, thread_key);
CREATE INDEX IF NOT EXISTS supplier_rma_requests_supplier_idx ON supplier_rma_requests (supplier_id);
CREATE INDEX IF NOT EXISTS rma_activity_log_rma_idx ON rma_activity_log (rma_id);
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
-- each table.
CREATE INDEX IF NOT EXISTS user_permission_roles_user_idx ON user_permission_roles (user_id);
CREATE INDEX IF NOT EXISTS permission_role_modules_role_idx ON permission_role_modules (role_id, module_name);

-- password_reset_tokens is only ever queried pre-auth (see its own schema
-- comment), but its actual lookup shape still needs a
-- real index: reset-password looks it up by token_hash, forgot-password's
-- rate-limiting/cleanup looks it up by user_id.
CREATE INDEX IF NOT EXISTS password_reset_tokens_hash_idx ON password_reset_tokens (token_hash);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS mfa_recovery_codes_user_idx ON mfa_recovery_codes (user_id);
