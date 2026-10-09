-- Clear a number only when it is exactly the prefix plus this row's id,
-- migration 0113 wrote it, and nobody typed a number for that record.
-- A typed number stays, even when the text is prefix+id.
-- User-entered means a create audit that already stored the number,
-- or any audit with numberEdit (the field a person changed).
-- 0113 wrote prefix+id in SQL and did not write an audit row.
-- This file does not add columns. Deploys before it runs keep working.
-- Saved-copy file names that end in _{that id}_{date} drop the id.

UPDATE "ncr" AS row
SET "record_number" = NULL
WHERE btrim(row."record_number") = 'NCR-' || row.id::text
  AND NOT EXISTS (
    SELECT 1 FROM "audit_trail" AS audit
    WHERE audit."entity_type" = 'NCR'
      AND audit."entity_id" = row.id
      AND (
        audit."changes" ? 'numberEdit'
        OR (audit."action" = 'create' AND nullif(btrim(audit."changes"->>'recordNumber'), '') IS NOT NULL)
      )
  );
--> statement-breakpoint
UPDATE "capa" AS row
SET "record_number" = NULL
WHERE btrim(row."record_number") = 'CAPA-' || row.id::text
  AND NOT EXISTS (
    SELECT 1 FROM "audit_trail" AS audit
    WHERE audit."entity_type" = 'CAPA'
      AND audit."entity_id" = row.id
      AND (
        audit."changes" ? 'numberEdit'
        OR (audit."action" = 'create' AND nullif(btrim(audit."changes"->>'recordNumber'), '') IS NOT NULL)
      )
  );
--> statement-breakpoint
UPDATE "eight_d" AS row
SET "record_number" = NULL
WHERE btrim(row."record_number") = '8D-' || row.id::text
  AND NOT EXISTS (
    SELECT 1 FROM "audit_trail" AS audit
    WHERE audit."entity_type" = '8D Report'
      AND audit."entity_id" = row.id
      AND (
        audit."changes" ? 'numberEdit'
        OR (audit."action" = 'create' AND nullif(btrim(audit."changes"->>'recordNumber'), '') IS NOT NULL)
      )
  );
--> statement-breakpoint
UPDATE "audits" AS row
SET "record_number" = NULL
WHERE btrim(row."record_number") = 'Audit #' || row.id::text
  AND NOT EXISTS (
    SELECT 1 FROM "audit_trail" AS audit
    WHERE audit."entity_type" = 'Audit'
      AND audit."entity_id" = row.id
      AND (
        audit."changes" ? 'numberEdit'
        OR (audit."action" = 'create' AND nullif(btrim(audit."changes"->>'recordNumber'), '') IS NOT NULL)
      )
  );
--> statement-breakpoint
UPDATE "complaints" AS row
SET "record_number" = NULL
WHERE btrim(row."record_number") = 'Complaint #' || row.id::text
  AND NOT EXISTS (
    SELECT 1 FROM "audit_trail" AS audit
    WHERE audit."entity_type" = 'Complaint'
      AND audit."entity_id" = row.id
      AND (
        audit."changes" ? 'numberEdit'
        OR (audit."action" = 'create' AND nullif(btrim(audit."changes"->>'recordNumber'), '') IS NOT NULL)
      )
  );
--> statement-breakpoint
UPDATE "change_requests" AS row
SET "record_number" = NULL
WHERE btrim(row."record_number") = 'CHG-' || row.id::text
  AND NOT EXISTS (
    SELECT 1 FROM "audit_trail" AS audit
    WHERE audit."entity_type" = 'Change request'
      AND audit."entity_id" = row.id
      AND (
        audit."changes" ? 'numberEdit'
        OR (audit."action" = 'create' AND nullif(btrim(audit."changes"->>'recordNumber'), '') IS NOT NULL)
      )
  );
--> statement-breakpoint
UPDATE "ppap_packages" AS row
SET "record_number" = NULL
WHERE btrim(row."record_number") = 'PPAP-' || row.id::text
  AND NOT EXISTS (
    SELECT 1 FROM "audit_trail" AS audit
    WHERE audit."entity_type" = 'PPAP package'
      AND audit."entity_id" = row.id
      AND (
        audit."changes" ? 'numberEdit'
        OR (audit."action" = 'create' AND nullif(btrim(audit."changes"->>'recordNumber'), '') IS NOT NULL)
      )
  );
--> statement-breakpoint
UPDATE "risk_assessments" AS row
SET "record_number" = NULL
WHERE btrim(row."record_number") = 'RISK-' || row.id::text
  AND NOT EXISTS (
    SELECT 1 FROM "audit_trail" AS audit
    WHERE audit."entity_type" = 'RiskAssessment'
      AND audit."entity_id" = row.id
      AND (
        audit."changes" ? 'numberEdit'
        OR (audit."action" = 'create' AND nullif(btrim(audit."changes"->>'recordNumber'), '') IS NOT NULL)
      )
  );
--> statement-breakpoint
UPDATE "work_orders" AS row
SET "record_number" = NULL
WHERE btrim(row."record_number") = 'WO-' || row.id::text
  AND NOT EXISTS (
    SELECT 1 FROM "audit_trail" AS audit
    WHERE audit."entity_type" = 'WorkOrder'
      AND audit."entity_id" = row.id
      AND (
        audit."changes" ? 'numberEdit'
        OR (audit."action" = 'create' AND nullif(btrim(audit."changes"->>'recordNumber'), '') IS NOT NULL)
      )
  );
--> statement-breakpoint
UPDATE "validation_reports" AS row
SET "record_number" = NULL
WHERE btrim(row."record_number") = 'VAL-' || row.id::text
  AND NOT EXISTS (
    SELECT 1 FROM "audit_trail" AS audit
    WHERE audit."entity_type" = 'Validation Report'
      AND audit."entity_id" = row.id
      AND (
        audit."changes" ? 'numberEdit'
        OR (audit."action" = 'create' AND nullif(btrim(audit."changes"->>'recordNumber'), '') IS NOT NULL)
      )
  );
--> statement-breakpoint
UPDATE "iso_quality_forms" AS row
SET "record_number" = NULL
WHERE row."form_type" IN ('first_article', 'engineering_change', 'salt_spray', 'prototype_strut')
  AND btrim(row."record_number") = CASE row."form_type"
    WHEN 'first_article' THEN 'FAI-' || row.id::text
    WHEN 'engineering_change' THEN 'ECR-' || row.id::text
    WHEN 'salt_spray' THEN 'TRP-' || row.id::text
    WHEN 'prototype_strut' THEN 'TRP-' || row.id::text
  END
  AND NOT EXISTS (
    SELECT 1 FROM "audit_trail" AS audit
    WHERE audit."entity_type" = 'ISO form'
      AND audit."entity_id" = row.id
      AND (
        audit."changes" ? 'numberEdit'
        OR (audit."action" = 'create' AND nullif(btrim(audit."changes"->>'recordNumber'), '') IS NOT NULL)
      )
  );
--> statement-breakpoint
UPDATE "scar_forms" AS row
SET "scar_number" = NULL
WHERE btrim(row."scar_number") = 'SCAR-' || row.id::text
  AND NOT EXISTS (
    SELECT 1 FROM "audit_trail" AS audit
    WHERE audit."entity_type" = 'ScarForm'
      AND audit."entity_id" = row.id
      AND (
        audit."changes" ? 'numberEdit'
        OR (audit."action" = 'create' AND nullif(btrim(audit."changes"->>'scarNumber'), '') IS NOT NULL)
      )
  );
--> statement-breakpoint
UPDATE "document_folders"
SET "name" = regexp_replace(
  "name",
  '_' || substring("linked_path" from '/([0-9]+)$') || '_([0-9]{4}-[0-9]{2}-[0-9]{2})$',
  '_\1'
)
WHERE "linked_path" ~ '/[0-9]+$'
  AND "name" ~ ('_' || substring("linked_path" from '/([0-9]+)$') || '_[0-9]{4}-[0-9]{2}-[0-9]{2}$');
