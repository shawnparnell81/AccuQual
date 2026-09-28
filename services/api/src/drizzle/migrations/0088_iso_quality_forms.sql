-- Filled ISO quality forms (audit checklist, standalone NCR, quarantine notice,
-- concession, training record, cross-training rubric). Cells live in data.
-- This table is separate from the NCR and CAPA modules.
CREATE TABLE "iso_quality_forms" (
	"id" serial PRIMARY KEY NOT NULL,
	"form_type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
