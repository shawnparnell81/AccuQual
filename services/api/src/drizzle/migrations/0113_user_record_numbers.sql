-- User-entered record numbers. Existing assigned numbers are copied onto the row
-- when that text is not already used. New rows stay blank until someone types a number.
-- The same text may be reused on a different record type.
--
-- A case- and space-insensitive unique index is added only when the table has no
-- such collision. Existing rows are not rewritten to make the index fit. When a
-- collision is already stored, the index is skipped and later saves and edits
-- are rejected by the application instead.

ALTER TABLE "ncr" ADD COLUMN IF NOT EXISTS "record_number" text;
--> statement-breakpoint
UPDATE "ncr" AS row
SET "record_number" = 'NCR-' || row.id::text
WHERE row."record_number" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ncr" AS other
    WHERE other.id <> row.id
      AND other."record_number" IS NOT NULL
      AND btrim(other."record_number") <> ''
      AND lower(regexp_replace(other."record_number", '[[:space:]]+', '', 'g')) = lower(regexp_replace('NCR-' || row.id::text, '[[:space:]]+', '', 'g'))
  );
--> statement-breakpoint
ALTER TABLE "capa" ADD COLUMN IF NOT EXISTS "record_number" text;
--> statement-breakpoint
UPDATE "capa" AS row
SET "record_number" = 'CAPA-' || row.id::text
WHERE row."record_number" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "capa" AS other
    WHERE other.id <> row.id
      AND other."record_number" IS NOT NULL
      AND btrim(other."record_number") <> ''
      AND lower(regexp_replace(other."record_number", '[[:space:]]+', '', 'g')) = lower(regexp_replace('CAPA-' || row.id::text, '[[:space:]]+', '', 'g'))
  );
--> statement-breakpoint
ALTER TABLE "eight_d" ADD COLUMN IF NOT EXISTS "record_number" text;
--> statement-breakpoint
UPDATE "eight_d" AS row
SET "record_number" = '8D-' || row.id::text
WHERE row."record_number" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "eight_d" AS other
    WHERE other.id <> row.id
      AND other."record_number" IS NOT NULL
      AND btrim(other."record_number") <> ''
      AND lower(regexp_replace(other."record_number", '[[:space:]]+', '', 'g')) = lower(regexp_replace('8D-' || row.id::text, '[[:space:]]+', '', 'g'))
  );
--> statement-breakpoint
ALTER TABLE "audits" ADD COLUMN IF NOT EXISTS "record_number" text;
--> statement-breakpoint
UPDATE "audits" AS row
SET "record_number" = 'Audit #' || row.id::text
WHERE row."record_number" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "audits" AS other
    WHERE other.id <> row.id
      AND other."record_number" IS NOT NULL
      AND btrim(other."record_number") <> ''
      AND lower(regexp_replace(other."record_number", '[[:space:]]+', '', 'g')) = lower(regexp_replace('Audit #' || row.id::text, '[[:space:]]+', '', 'g'))
  );
--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN IF NOT EXISTS "record_number" text;
--> statement-breakpoint
UPDATE "complaints" AS row
SET "record_number" = 'Complaint #' || row.id::text
WHERE row."record_number" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "complaints" AS other
    WHERE other.id <> row.id
      AND other."record_number" IS NOT NULL
      AND btrim(other."record_number") <> ''
      AND lower(regexp_replace(other."record_number", '[[:space:]]+', '', 'g')) = lower(regexp_replace('Complaint #' || row.id::text, '[[:space:]]+', '', 'g'))
  );
--> statement-breakpoint
ALTER TABLE "change_requests" ADD COLUMN IF NOT EXISTS "record_number" text;
--> statement-breakpoint
UPDATE "change_requests" AS row
SET "record_number" = 'CHG-' || row.id::text
WHERE row."record_number" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "change_requests" AS other
    WHERE other.id <> row.id
      AND other."record_number" IS NOT NULL
      AND btrim(other."record_number") <> ''
      AND lower(regexp_replace(other."record_number", '[[:space:]]+', '', 'g')) = lower(regexp_replace('CHG-' || row.id::text, '[[:space:]]+', '', 'g'))
  );
--> statement-breakpoint
ALTER TABLE "ppap_packages" ADD COLUMN IF NOT EXISTS "record_number" text;
--> statement-breakpoint
UPDATE "ppap_packages" AS row
SET "record_number" = 'PPAP-' || row.id::text
WHERE row."record_number" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ppap_packages" AS other
    WHERE other.id <> row.id
      AND other."record_number" IS NOT NULL
      AND btrim(other."record_number") <> ''
      AND lower(regexp_replace(other."record_number", '[[:space:]]+', '', 'g')) = lower(regexp_replace('PPAP-' || row.id::text, '[[:space:]]+', '', 'g'))
  );
--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD COLUMN IF NOT EXISTS "record_number" text;
--> statement-breakpoint
UPDATE "risk_assessments" AS row
SET "record_number" = 'RISK-' || row.id::text
WHERE row."record_number" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "risk_assessments" AS other
    WHERE other.id <> row.id
      AND other."record_number" IS NOT NULL
      AND btrim(other."record_number") <> ''
      AND lower(regexp_replace(other."record_number", '[[:space:]]+', '', 'g')) = lower(regexp_replace('RISK-' || row.id::text, '[[:space:]]+', '', 'g'))
  );
--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "record_number" text;
--> statement-breakpoint
UPDATE "work_orders" AS row
SET "record_number" = 'WO-' || row.id::text
WHERE row."record_number" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "work_orders" AS other
    WHERE other.id <> row.id
      AND other."record_number" IS NOT NULL
      AND btrim(other."record_number") <> ''
      AND lower(regexp_replace(other."record_number", '[[:space:]]+', '', 'g')) = lower(regexp_replace('WO-' || row.id::text, '[[:space:]]+', '', 'g'))
  );
--> statement-breakpoint
ALTER TABLE "discrepancy_investigations" ADD COLUMN IF NOT EXISTS "record_number" text;
--> statement-breakpoint
ALTER TABLE "quality_inspection_reports" ADD COLUMN IF NOT EXISTS "record_number" text;
--> statement-breakpoint
ALTER TABLE "validation_reports" ADD COLUMN IF NOT EXISTS "record_number" text;
--> statement-breakpoint
UPDATE "validation_reports" AS row
SET "record_number" = 'VAL-' || row.id::text
WHERE row."record_number" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "validation_reports" AS other
    WHERE other.id <> row.id
      AND COALESCE(other."data"->>'formType', 'csa') = COALESCE(row."data"->>'formType', 'csa')
      AND other."record_number" IS NOT NULL
      AND btrim(other."record_number") <> ''
      AND lower(regexp_replace(other."record_number", '[[:space:]]+', '', 'g')) = lower(regexp_replace('VAL-' || row.id::text, '[[:space:]]+', '', 'g'))
  );
--> statement-breakpoint
ALTER TABLE "iso_quality_forms" ADD COLUMN IF NOT EXISTS "record_number" text;
--> statement-breakpoint
UPDATE "iso_quality_forms" AS row
SET "record_number" = CASE row."form_type"
  WHEN 'first_article' THEN 'FAI-' || row.id::text
  WHEN 'engineering_change' THEN 'ECR-' || row.id::text
  WHEN 'salt_spray' THEN 'TRP-' || row.id::text
  WHEN 'prototype_strut' THEN 'TRP-' || row.id::text
  ELSE row."record_number"
END
WHERE row."record_number" IS NULL
  AND row."form_type" IN ('first_article', 'engineering_change', 'salt_spray', 'prototype_strut')
  AND NOT EXISTS (
    SELECT 1 FROM "iso_quality_forms" AS other
    WHERE other.id <> row.id
      AND other."form_type" = row."form_type"
      AND other."record_number" IS NOT NULL
      AND btrim(other."record_number") <> ''
      AND lower(regexp_replace(other."record_number", '[[:space:]]+', '', 'g')) = lower(regexp_replace(
        CASE row."form_type"
          WHEN 'first_article' THEN 'FAI-' || row.id::text
          WHEN 'engineering_change' THEN 'ECR-' || row.id::text
          WHEN 'salt_spray' THEN 'TRP-' || row.id::text
          WHEN 'prototype_strut' THEN 'TRP-' || row.id::text
        END,
        '[[:space:]]+', '', 'g'))
  );
--> statement-breakpoint
ALTER TABLE "built_form_fills" ADD COLUMN IF NOT EXISTS "record_number" text;
--> statement-breakpoint
UPDATE "scar_forms" AS row
SET "scar_number" = 'SCAR-' || row.id::text
WHERE (row."scar_number" IS NULL OR btrim(row."scar_number") = '')
  AND NOT EXISTS (
    SELECT 1 FROM "scar_forms" AS other
    WHERE other.id <> row.id
      AND other."scar_number" IS NOT NULL
      AND btrim(other."scar_number") <> ''
      AND lower(regexp_replace(other."scar_number", '[[:space:]]+', '', 'g')) = lower(regexp_replace('SCAR-' || row.id::text, '[[:space:]]+', '', 'g'))
  );
--> statement-breakpoint
ALTER TABLE "fai_records" ALTER COLUMN "number" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "csa_fai_records" ALTER COLUMN "number" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "fuel_pump_fai_records" ALTER COLUMN "fai_number" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "rma" ALTER COLUMN "rma_number" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "warranty_claims" ALTER COLUMN "claim_number" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "rma_log" ALTER COLUMN "rma_number" DROP NOT NULL;
--> statement-breakpoint
-- Dropping an old exact-match constraint happens only after the replacement
-- index is known to fit. A unique_violation rolls that drop back, so a live
-- collision keeps the previous constraint and the stored numbers.
DO $migrate$
DECLARE
  spec record;
  has_dup boolean;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      (
        'ncr',
        $dup$SELECT EXISTS (
          SELECT 1 FROM "ncr"
          WHERE "record_number" IS NOT NULL AND btrim("record_number") <> ''
          GROUP BY lower(regexp_replace("record_number", '[[:space:]]+', '', 'g'))
          HAVING count(*) > 1
        )$dup$,
        '',
        $ddl$CREATE UNIQUE INDEX IF NOT EXISTS "ncr_record_number_key" ON "ncr" (lower(regexp_replace("record_number", '[[:space:]]+', '', 'g'))) WHERE "record_number" IS NOT NULL AND btrim("record_number") <> ''$ddl$
      ),
      (
        'capa',
        $dup$SELECT EXISTS (
          SELECT 1 FROM "capa"
          WHERE "record_number" IS NOT NULL AND btrim("record_number") <> ''
          GROUP BY lower(regexp_replace("record_number", '[[:space:]]+', '', 'g'))
          HAVING count(*) > 1
        )$dup$,
        '',
        $ddl$CREATE UNIQUE INDEX IF NOT EXISTS "capa_record_number_key" ON "capa" (lower(regexp_replace("record_number", '[[:space:]]+', '', 'g'))) WHERE "record_number" IS NOT NULL AND btrim("record_number") <> ''$ddl$
      ),
      (
        'eight_d',
        $dup$SELECT EXISTS (
          SELECT 1 FROM "eight_d"
          WHERE "record_number" IS NOT NULL AND btrim("record_number") <> ''
          GROUP BY lower(regexp_replace("record_number", '[[:space:]]+', '', 'g'))
          HAVING count(*) > 1
        )$dup$,
        '',
        $ddl$CREATE UNIQUE INDEX IF NOT EXISTS "eight_d_record_number_key" ON "eight_d" (lower(regexp_replace("record_number", '[[:space:]]+', '', 'g'))) WHERE "record_number" IS NOT NULL AND btrim("record_number") <> ''$ddl$
      ),
      (
        'audits',
        $dup$SELECT EXISTS (
          SELECT 1 FROM "audits"
          WHERE "record_number" IS NOT NULL AND btrim("record_number") <> ''
          GROUP BY lower(regexp_replace("record_number", '[[:space:]]+', '', 'g'))
          HAVING count(*) > 1
        )$dup$,
        '',
        $ddl$CREATE UNIQUE INDEX IF NOT EXISTS "audits_record_number_key" ON "audits" (lower(regexp_replace("record_number", '[[:space:]]+', '', 'g'))) WHERE "record_number" IS NOT NULL AND btrim("record_number") <> ''$ddl$
      ),
      (
        'complaints',
        $dup$SELECT EXISTS (
          SELECT 1 FROM "complaints"
          WHERE "record_number" IS NOT NULL AND btrim("record_number") <> ''
          GROUP BY lower(regexp_replace("record_number", '[[:space:]]+', '', 'g'))
          HAVING count(*) > 1
        )$dup$,
        '',
        $ddl$CREATE UNIQUE INDEX IF NOT EXISTS "complaints_record_number_key" ON "complaints" (lower(regexp_replace("record_number", '[[:space:]]+', '', 'g'))) WHERE "record_number" IS NOT NULL AND btrim("record_number") <> ''$ddl$
      ),
      (
        'change_requests',
        $dup$SELECT EXISTS (
          SELECT 1 FROM "change_requests"
          WHERE "record_number" IS NOT NULL AND btrim("record_number") <> ''
          GROUP BY lower(regexp_replace("record_number", '[[:space:]]+', '', 'g'))
          HAVING count(*) > 1
        )$dup$,
        '',
        $ddl$CREATE UNIQUE INDEX IF NOT EXISTS "change_requests_record_number_key" ON "change_requests" (lower(regexp_replace("record_number", '[[:space:]]+', '', 'g'))) WHERE "record_number" IS NOT NULL AND btrim("record_number") <> ''$ddl$
      ),
      (
        'ppap_packages',
        $dup$SELECT EXISTS (
          SELECT 1 FROM "ppap_packages"
          WHERE "record_number" IS NOT NULL AND btrim("record_number") <> ''
          GROUP BY lower(regexp_replace("record_number", '[[:space:]]+', '', 'g'))
          HAVING count(*) > 1
        )$dup$,
        '',
        $ddl$CREATE UNIQUE INDEX IF NOT EXISTS "ppap_packages_record_number_key" ON "ppap_packages" (lower(regexp_replace("record_number", '[[:space:]]+', '', 'g'))) WHERE "record_number" IS NOT NULL AND btrim("record_number") <> ''$ddl$
      ),
      (
        'risk_assessments',
        $dup$SELECT EXISTS (
          SELECT 1 FROM "risk_assessments"
          WHERE "record_number" IS NOT NULL AND btrim("record_number") <> ''
          GROUP BY lower(regexp_replace("record_number", '[[:space:]]+', '', 'g'))
          HAVING count(*) > 1
        )$dup$,
        '',
        $ddl$CREATE UNIQUE INDEX IF NOT EXISTS "risk_assessments_record_number_key" ON "risk_assessments" (lower(regexp_replace("record_number", '[[:space:]]+', '', 'g'))) WHERE "record_number" IS NOT NULL AND btrim("record_number") <> ''$ddl$
      ),
      (
        'work_orders',
        $dup$SELECT EXISTS (
          SELECT 1 FROM "work_orders"
          WHERE "record_number" IS NOT NULL AND btrim("record_number") <> ''
          GROUP BY lower(regexp_replace("record_number", '[[:space:]]+', '', 'g'))
          HAVING count(*) > 1
        )$dup$,
        '',
        $ddl$CREATE UNIQUE INDEX IF NOT EXISTS "work_orders_record_number_key" ON "work_orders" (lower(regexp_replace("record_number", '[[:space:]]+', '', 'g'))) WHERE "record_number" IS NOT NULL AND btrim("record_number") <> ''$ddl$
      ),
      (
        'discrepancy_investigations',
        $dup$SELECT EXISTS (
          SELECT 1 FROM "discrepancy_investigations"
          WHERE "record_number" IS NOT NULL AND btrim("record_number") <> ''
          GROUP BY lower(regexp_replace("record_number", '[[:space:]]+', '', 'g'))
          HAVING count(*) > 1
        )$dup$,
        '',
        $ddl$CREATE UNIQUE INDEX IF NOT EXISTS "discrepancy_investigations_record_number_key" ON "discrepancy_investigations" (lower(regexp_replace("record_number", '[[:space:]]+', '', 'g'))) WHERE "record_number" IS NOT NULL AND btrim("record_number") <> ''$ddl$
      ),
      (
        'quality_inspection_reports',
        $dup$SELECT EXISTS (
          SELECT 1 FROM "quality_inspection_reports"
          WHERE "record_number" IS NOT NULL AND btrim("record_number") <> ''
          GROUP BY lower(regexp_replace("record_number", '[[:space:]]+', '', 'g'))
          HAVING count(*) > 1
        )$dup$,
        '',
        $ddl$CREATE UNIQUE INDEX IF NOT EXISTS "quality_inspection_reports_record_number_key" ON "quality_inspection_reports" (lower(regexp_replace("record_number", '[[:space:]]+', '', 'g'))) WHERE "record_number" IS NOT NULL AND btrim("record_number") <> ''$ddl$
      ),
      (
        'validation_reports',
        $dup$SELECT EXISTS (
          SELECT 1 FROM "validation_reports"
          WHERE "record_number" IS NOT NULL AND btrim("record_number") <> ''
          GROUP BY COALESCE("data"->>'formType', 'csa'), lower(regexp_replace("record_number", '[[:space:]]+', '', 'g'))
          HAVING count(*) > 1
        )$dup$,
        '',
        $ddl$CREATE UNIQUE INDEX IF NOT EXISTS "validation_reports_record_number_key" ON "validation_reports" ((COALESCE("data"->>'formType', 'csa')), lower(regexp_replace("record_number", '[[:space:]]+', '', 'g'))) WHERE "record_number" IS NOT NULL AND btrim("record_number") <> ''$ddl$
      ),
      (
        'iso_quality_forms',
        $dup$SELECT EXISTS (
          SELECT 1 FROM "iso_quality_forms"
          WHERE "record_number" IS NOT NULL AND btrim("record_number") <> ''
          GROUP BY "form_type", lower(regexp_replace("record_number", '[[:space:]]+', '', 'g'))
          HAVING count(*) > 1
        )$dup$,
        '',
        $ddl$CREATE UNIQUE INDEX IF NOT EXISTS "iso_quality_forms_record_number_key" ON "iso_quality_forms" ("form_type", lower(regexp_replace("record_number", '[[:space:]]+', '', 'g'))) WHERE "record_number" IS NOT NULL AND btrim("record_number") <> ''$ddl$
      ),
      (
        'built_form_fills',
        $dup$SELECT EXISTS (
          SELECT 1 FROM "built_form_fills"
          WHERE "record_number" IS NOT NULL AND btrim("record_number") <> ''
          GROUP BY "form_id", lower(regexp_replace("record_number", '[[:space:]]+', '', 'g'))
          HAVING count(*) > 1
        )$dup$,
        '',
        $ddl$CREATE UNIQUE INDEX IF NOT EXISTS "built_form_fills_record_number_key" ON "built_form_fills" ("form_id", lower(regexp_replace("record_number", '[[:space:]]+', '', 'g'))) WHERE "record_number" IS NOT NULL AND btrim("record_number") <> ''$ddl$
      ),
      (
        'scar_forms',
        $dup$SELECT EXISTS (
          SELECT 1 FROM "scar_forms"
          WHERE "scar_number" IS NOT NULL AND btrim("scar_number") <> ''
          GROUP BY lower(regexp_replace("scar_number", '[[:space:]]+', '', 'g'))
          HAVING count(*) > 1
        )$dup$,
        '',
        $ddl$CREATE UNIQUE INDEX IF NOT EXISTS "scar_forms_scar_number_key" ON "scar_forms" (lower(regexp_replace("scar_number", '[[:space:]]+', '', 'g'))) WHERE "scar_number" IS NOT NULL AND btrim("scar_number") <> ''$ddl$
      ),
      (
        'qms_forms',
        $dup$SELECT EXISTS (
          SELECT 1 FROM "qms_forms"
          WHERE "form_no" IS NOT NULL AND btrim("form_no") <> ''
          GROUP BY "form_type", lower(regexp_replace("form_no", '[[:space:]]+', '', 'g'))
          HAVING count(*) > 1
        )$dup$,
        '',
        $ddl$CREATE UNIQUE INDEX IF NOT EXISTS "qms_forms_form_no_key" ON "qms_forms" ("form_type", lower(regexp_replace("form_no", '[[:space:]]+', '', 'g'))) WHERE "form_no" IS NOT NULL AND btrim("form_no") <> ''$ddl$
      ),
      (
        'document_change_requests',
        $dup$SELECT EXISTS (
          SELECT 1 FROM "document_change_requests"
          WHERE "form_no" IS NOT NULL AND btrim("form_no") <> ''
          GROUP BY lower(regexp_replace("form_no", '[[:space:]]+', '', 'g'))
          HAVING count(*) > 1
        )$dup$,
        '',
        $ddl$CREATE UNIQUE INDEX IF NOT EXISTS "document_change_requests_form_no_key" ON "document_change_requests" (lower(regexp_replace("form_no", '[[:space:]]+', '', 'g'))) WHERE "form_no" IS NOT NULL AND btrim("form_no") <> ''$ddl$
      ),
      (
        'fai_records',
        $dup$SELECT EXISTS (
          SELECT 1 FROM "fai_records"
          WHERE "number" IS NOT NULL AND btrim("number") <> ''
          GROUP BY lower(regexp_replace("number", '[[:space:]]+', '', 'g'))
          HAVING count(*) > 1
        )$dup$,
        $ddl$ALTER TABLE "fai_records" DROP CONSTRAINT IF EXISTS "fai_records_number_key"$ddl$,
        $ddl$CREATE UNIQUE INDEX IF NOT EXISTS "fai_records_number_key" ON "fai_records" (lower(regexp_replace("number", '[[:space:]]+', '', 'g'))) WHERE "number" IS NOT NULL AND btrim("number") <> ''$ddl$
      ),
      (
        'csa_fai_records',
        $dup$SELECT EXISTS (
          SELECT 1 FROM "csa_fai_records"
          WHERE "number" IS NOT NULL AND btrim("number") <> ''
          GROUP BY lower(regexp_replace("number", '[[:space:]]+', '', 'g'))
          HAVING count(*) > 1
        )$dup$,
        $ddl$ALTER TABLE "csa_fai_records" DROP CONSTRAINT IF EXISTS "csa_fai_records_number_key"$ddl$,
        $ddl$CREATE UNIQUE INDEX IF NOT EXISTS "csa_fai_records_number_key" ON "csa_fai_records" (lower(regexp_replace("number", '[[:space:]]+', '', 'g'))) WHERE "number" IS NOT NULL AND btrim("number") <> ''$ddl$
      ),
      (
        'fuel_pump_fai_records',
        $dup$SELECT EXISTS (
          SELECT 1 FROM "fuel_pump_fai_records"
          WHERE "fai_number" IS NOT NULL AND btrim("fai_number") <> ''
          GROUP BY lower(regexp_replace("fai_number", '[[:space:]]+', '', 'g'))
          HAVING count(*) > 1
        )$dup$,
        $ddl$ALTER TABLE "fuel_pump_fai_records" DROP CONSTRAINT IF EXISTS "fuel_pump_fai_records_fai_number_key"$ddl$,
        $ddl$CREATE UNIQUE INDEX IF NOT EXISTS "fuel_pump_fai_records_fai_number_key" ON "fuel_pump_fai_records" (lower(regexp_replace("fai_number", '[[:space:]]+', '', 'g'))) WHERE "fai_number" IS NOT NULL AND btrim("fai_number") <> ''$ddl$
      ),
      (
        'rma',
        $dup$SELECT EXISTS (
          SELECT 1 FROM "rma"
          WHERE "rma_number" IS NOT NULL AND btrim("rma_number") <> ''
          GROUP BY lower(regexp_replace("rma_number", '[[:space:]]+', '', 'g'))
          HAVING count(*) > 1
        )$dup$,
        $ddl$ALTER TABLE "rma" DROP CONSTRAINT IF EXISTS "rma_rma_number_unique"$ddl$,
        $ddl$CREATE UNIQUE INDEX IF NOT EXISTS "rma_rma_number_key" ON "rma" (lower(regexp_replace("rma_number", '[[:space:]]+', '', 'g'))) WHERE "rma_number" IS NOT NULL AND btrim("rma_number") <> ''$ddl$
      ),
      (
        'rma_log',
        $dup$SELECT EXISTS (
          SELECT 1 FROM "rma_log"
          WHERE "rma_number" IS NOT NULL AND btrim("rma_number") <> ''
          GROUP BY lower(regexp_replace("rma_number", '[[:space:]]+', '', 'g'))
          HAVING count(*) > 1
        )$dup$,
        $ddl$DROP INDEX IF EXISTS "rma_log_rma_number_idx"$ddl$,
        $ddl$CREATE UNIQUE INDEX IF NOT EXISTS "rma_log_rma_number_key" ON "rma_log" (lower(regexp_replace("rma_number", '[[:space:]]+', '', 'g'))) WHERE "rma_number" IS NOT NULL AND btrim("rma_number") <> ''$ddl$
      ),
      (
        'warranty_claims',
        $dup$SELECT EXISTS (
          SELECT 1 FROM "warranty_claims"
          WHERE "claim_number" IS NOT NULL AND btrim("claim_number") <> ''
          GROUP BY lower(regexp_replace("claim_number", '[[:space:]]+', '', 'g'))
          HAVING count(*) > 1
        )$dup$,
        $ddl$ALTER TABLE "warranty_claims" DROP CONSTRAINT IF EXISTS "warranty_claims_claim_number_unique"$ddl$,
        $ddl$CREATE UNIQUE INDEX IF NOT EXISTS "warranty_claims_claim_number_key" ON "warranty_claims" (lower(regexp_replace("claim_number", '[[:space:]]+', '', 'g'))) WHERE "claim_number" IS NOT NULL AND btrim("claim_number") <> ''$ddl$
      )
    ) AS v(label, dup_sql, drop_sql, create_sql)
  LOOP
    EXECUTE spec.dup_sql INTO has_dup;
    IF COALESCE(has_dup, false) THEN
      RAISE WARNING '%: existing numbers already collide (case- and space-insensitive). Those rows were left unchanged. New saves and edits are rejected by the application.', spec.label;
      CONTINUE;
    END IF;
    BEGIN
      IF spec.drop_sql <> '' THEN
        EXECUTE spec.drop_sql;
      END IF;
      EXECUTE spec.create_sql;
    EXCEPTION WHEN unique_violation THEN
      RAISE WARNING '%: uniqueness index skipped because live rows already share a number. Those rows were left unchanged.', spec.label;
    END;
  END LOOP;
END
$migrate$;
