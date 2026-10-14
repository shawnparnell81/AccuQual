-- Access that used to follow fixed role names now follows permissions stored on the role.
-- Each role gets exactly the access it had before, so nobody gains or loses anything on deploy.
-- Admin can change these afterwards on the Roles page. Additive only.
UPDATE "roles"
SET "permissions" = "permissions" || '["admin_console"]'::jsonb
WHERE "name" IN ('admin', 'owner') AND NOT ("permissions" ? 'admin_console');
--> statement-breakpoint
UPDATE "roles"
SET "permissions" = "permissions" || '["users.list"]'::jsonb
WHERE "name" IN ('admin', 'owner', 'quality_manager') AND NOT ("permissions" ? 'users.list');
--> statement-breakpoint
UPDATE "roles"
SET "permissions" = "permissions" || '["quality_automation.manage"]'::jsonb
WHERE "name" IN ('admin', 'owner', 'quality_manager') AND NOT ("permissions" ? 'quality_automation.manage');
--> statement-breakpoint
UPDATE "roles"
SET "permissions" = "permissions" || '["records.delete"]'::jsonb
WHERE "name" IN ('admin', 'owner', 'quality_manager') AND NOT ("permissions" ? 'records.delete');
--> statement-breakpoint
UPDATE "roles"
SET "permissions" = "permissions" || '["forms.edit_number"]'::jsonb
WHERE "name" IN ('admin', 'owner', 'quality_manager') AND NOT ("permissions" ? 'forms.edit_number');
--> statement-breakpoint
UPDATE "roles"
SET "permissions" = "permissions" || '["digest.receive"]'::jsonb
WHERE "name" IN ('admin', 'owner', 'quality_manager', 'president', 'vice_president') AND NOT ("permissions" ? 'digest.receive');
