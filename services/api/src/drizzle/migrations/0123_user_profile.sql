-- Team member profile. The application reads and writes these columns with a
-- missing-column guard, so a deploy can run before this migration.
-- employee_id is typed by an administrator. Nothing here generates a number.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "preferred_name" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "job_title" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employee_id" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "hire_date" date;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "employment_type" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "shift" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "site_location" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bio" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_attachment_id" integer;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "require_mfa" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "onboarding_checklist" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "users"
    ADD CONSTRAINT "users_avatar_attachment_id_attachments_id_fk"
    FOREIGN KEY ("avatar_attachment_id") REFERENCES "attachments"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
