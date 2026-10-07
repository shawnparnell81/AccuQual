-- Recipients for a saved Quality / Engineering monthly report.
-- report_schedules.recipients already stores a list, so nothing is copied from a single address.
-- Existing quality_engineering_reports rows gain an empty list.

ALTER TABLE "quality_engineering_reports"
  ADD COLUMN IF NOT EXISTS "recipients" jsonb NOT NULL DEFAULT '[]'::jsonb;
