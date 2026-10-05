-- Saved Quality / Engineering monthly reports (TMP-ENG-001 style).
-- Supplier warranty numbers live in supplier_data (uploaded). Narrative is edited in Reports.
-- 0100 through 0107 are unchanged. This file is 0108.

CREATE TABLE IF NOT EXISTS "quality_engineering_reports" (
  "id" serial PRIMARY KEY,
  "year" integer NOT NULL,
  "month" integer NOT NULL,
  "narrative" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "supplier_data" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "upload_file_name" text,
  "created_by" integer REFERENCES "users"("id"),
  "updated_by" integer REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp,
  CONSTRAINT "quality_engineering_reports_month_ck" CHECK ("month" >= 1 AND "month" <= 12),
  CONSTRAINT "quality_engineering_reports_year_month_uq" UNIQUE ("year", "month")
);
