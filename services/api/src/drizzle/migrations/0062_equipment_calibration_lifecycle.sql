ALTER TABLE "calibrations" ALTER COLUMN "performed_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "calibrations" ADD COLUMN "status" text DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE "calibrations" ADD COLUMN "scheduled_at" timestamp;--> statement-breakpoint
ALTER TABLE "calibrations" ADD COLUMN "scheduled_by" integer;--> statement-breakpoint
ALTER TABLE "calibrations" ADD COLUMN "completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "calibrations" ADD COLUMN "results" jsonb;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "type" text;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "status_cause" text;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "status_changed_at" timestamp;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "status_changed_by" integer;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "calibrations" ADD CONSTRAINT "calibrations_scheduled_by_users_id_fk" FOREIGN KEY ("scheduled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Existing calibration rows predate scheduling: they are finished events. A row recorded as "fail" is a failed calibration, and it
-- never established a new due date (the old code computed one anyway), so its next_due_at is cleared.
UPDATE "calibrations" SET "completed_at" = "performed_at", "scheduled_at" = COALESCE("scheduled_at", "performed_at"), "status" = CASE WHEN "result" = 'fail' THEN 'failed' ELSE 'completed' END;--> statement-breakpoint
UPDATE "calibrations" SET "next_due_at" = NULL WHERE "result" = 'fail';--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_status_check" CHECK ("status" IN ('active', 'inactive', 'out_of_service'));--> statement-breakpoint
ALTER TABLE "calibrations" ADD CONSTRAINT "calibrations_status_check" CHECK ("status" IN ('scheduled', 'completed', 'failed'));
