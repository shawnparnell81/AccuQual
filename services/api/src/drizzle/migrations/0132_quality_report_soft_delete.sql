-- Monthly Quality Report: delete a month's report (soft delete, like other records).
-- A deleted month keeps its row but no longer holds the month, so a fresh report can be started for it.
ALTER TABLE "quality_engineering_reports" ADD COLUMN IF NOT EXISTS "is_deleted" boolean NOT NULL DEFAULT false;
ALTER TABLE "quality_engineering_reports" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "quality_engineering_reports" ADD COLUMN IF NOT EXISTS "deleted_by" integer REFERENCES "users"("id");

ALTER TABLE "quality_engineering_reports" DROP CONSTRAINT IF EXISTS "quality_engineering_reports_year_month_uq";
DROP INDEX IF EXISTS "quality_engineering_reports_year_month_uq";
CREATE UNIQUE INDEX IF NOT EXISTS "quality_engineering_reports_year_month_uq" ON "quality_engineering_reports" ("year", "month") WHERE "is_deleted" = false;
