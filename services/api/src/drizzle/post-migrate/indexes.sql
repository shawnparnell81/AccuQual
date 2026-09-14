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
    'rma', 'rma_items'
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

-- password_reset_tokens isn't in the tenant_tables array above (see its own
-- schema comment — it's only ever queried via the unscoped db, pre-auth,
-- same as users/roles/tenants), but its actual lookup shape still needs a
-- real index: reset-password looks it up by token_hash, forgot-password's
-- rate-limiting/cleanup looks it up by user_id.
CREATE INDEX IF NOT EXISTS password_reset_tokens_hash_idx ON password_reset_tokens (token_hash);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON password_reset_tokens (user_id);
