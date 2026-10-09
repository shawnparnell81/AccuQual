-- Drop the numbers migration 0113 wrote from each row's id.
-- A number someone typed stays, unless it is exactly that prefix plus this row's id.
-- Saved-copy file names that end in _{that id}_{date} drop the id.
-- Audits and equipment record a save time. Rows that already exist count as saved.

UPDATE "ncr" SET "record_number" = NULL WHERE btrim("record_number") = 'NCR-' || id::text;
--> statement-breakpoint
UPDATE "capa" SET "record_number" = NULL WHERE btrim("record_number") = 'CAPA-' || id::text;
--> statement-breakpoint
UPDATE "eight_d" SET "record_number" = NULL WHERE btrim("record_number") = '8D-' || id::text;
--> statement-breakpoint
UPDATE "audits" SET "record_number" = NULL WHERE btrim("record_number") = 'Audit #' || id::text;
--> statement-breakpoint
UPDATE "complaints" SET "record_number" = NULL WHERE btrim("record_number") = 'Complaint #' || id::text;
--> statement-breakpoint
UPDATE "change_requests" SET "record_number" = NULL WHERE btrim("record_number") = 'CHG-' || id::text;
--> statement-breakpoint
UPDATE "ppap_packages" SET "record_number" = NULL WHERE btrim("record_number") = 'PPAP-' || id::text;
--> statement-breakpoint
UPDATE "risk_assessments" SET "record_number" = NULL WHERE btrim("record_number") = 'RISK-' || id::text;
--> statement-breakpoint
UPDATE "work_orders" SET "record_number" = NULL WHERE btrim("record_number") = 'WO-' || id::text;
--> statement-breakpoint
UPDATE "validation_reports" SET "record_number" = NULL WHERE btrim("record_number") = 'VAL-' || id::text;
--> statement-breakpoint
UPDATE "iso_quality_forms" AS row
SET "record_number" = NULL
WHERE row."form_type" IN ('first_article', 'engineering_change', 'salt_spray', 'prototype_strut')
  AND btrim(row."record_number") = CASE row."form_type"
    WHEN 'first_article' THEN 'FAI-' || row.id::text
    WHEN 'engineering_change' THEN 'ECR-' || row.id::text
    WHEN 'salt_spray' THEN 'TRP-' || row.id::text
    WHEN 'prototype_strut' THEN 'TRP-' || row.id::text
  END;
--> statement-breakpoint
UPDATE "scar_forms" SET "scar_number" = NULL WHERE btrim("scar_number") = 'SCAR-' || id::text;
--> statement-breakpoint
UPDATE "document_folders"
SET "name" = regexp_replace(
  "name",
  '_' || substring("linked_path" from '/([0-9]+)$') || '_([0-9]{4}-[0-9]{2}-[0-9]{2})$',
  '_\1'
)
WHERE "linked_path" ~ '/[0-9]+$'
  AND "name" ~ ('_' || substring("linked_path" from '/([0-9]+)$') || '_[0-9]{4}-[0-9]{2}-[0-9]{2}$');
--> statement-breakpoint
ALTER TABLE "audits" ADD COLUMN IF NOT EXISTS "updated_at" timestamp;
--> statement-breakpoint
UPDATE "audits" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN IF NOT EXISTS "updated_at" timestamp;
--> statement-breakpoint
UPDATE "equipment" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
