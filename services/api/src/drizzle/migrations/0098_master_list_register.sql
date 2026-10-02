-- Approval Date and Approved By typed on the Master Document List.
-- Null means the cell was never edited here. A blank string is a saved clear.
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "register_approval_date" text;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "register_approved_by" text;
--> statement-breakpoint
ALTER TABLE "controlled_form_templates" ADD COLUMN IF NOT EXISTS "register_approval_date" text;
--> statement-breakpoint
ALTER TABLE "controlled_form_templates" ADD COLUMN IF NOT EXISTS "register_approved_by" text;
