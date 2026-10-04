-- Required Yes/No for a signature block on a filled record.
-- 0100 through 0106 are unchanged. This file is 0107.
-- JSON records keep the choice inside their existing data.
-- These tables have no general field-values blob, so the choice is a column.
-- Work-order operation choices live in the work order map as op:<id>.

ALTER TABLE "scar_forms" ADD COLUMN IF NOT EXISTS "signature_required" jsonb;
--> statement-breakpoint
ALTER TABLE "quality_inspection_reports" ADD COLUMN IF NOT EXISTS "signature_required" jsonb;
--> statement-breakpoint
ALTER TABLE "document_change_requests" ADD COLUMN IF NOT EXISTS "signature_required" jsonb;
--> statement-breakpoint
ALTER TABLE "crar" ADD COLUMN IF NOT EXISTS "signature_required" jsonb;
--> statement-breakpoint
ALTER TABLE "feasibility_reviews" ADD COLUMN IF NOT EXISTS "signature_required" jsonb;
--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "signature_required" jsonb;
