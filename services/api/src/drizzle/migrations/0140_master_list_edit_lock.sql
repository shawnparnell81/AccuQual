-- 0140_master_list_edit_lock.sql: master lists open read-only until someone with Edit master lists clicks Edit.
-- Additive only. No list data or revision is changed.
ALTER TABLE controlled_lists ADD COLUMN IF NOT EXISTS edit_snapshot JSONB;
--> statement-breakpoint
ALTER TABLE controlled_lists ADD COLUMN IF NOT EXISTS edit_revision TEXT;
--> statement-breakpoint
ALTER TABLE controlled_lists ADD COLUMN IF NOT EXISTS edit_by INTEGER REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE controlled_lists ADD COLUMN IF NOT EXISTS edit_started_at TIMESTAMP;
--> statement-breakpoint
-- Starting grant. Admin can change it afterwards on the Roles page.
UPDATE "roles"
SET "permissions" = "permissions" || '["controlled_lists.edit"]'::jsonb
WHERE "name" IN ('owner', 'admin', 'quality_manager', 'engineering_manager', 'vice_president') AND NOT ("permissions" ? 'controlled_lists.edit');
