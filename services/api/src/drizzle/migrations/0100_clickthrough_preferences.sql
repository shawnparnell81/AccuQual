-- Per-user home and dashboard arrangement, and company What's New notes.
-- Adds columns only. Existing rows keep their data. Empty notes are the default.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "workspace_layout" jsonb;
--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "release_notes" jsonb DEFAULT '[]'::jsonb NOT NULL;
