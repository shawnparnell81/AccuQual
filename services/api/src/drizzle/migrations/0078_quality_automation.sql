ALTER TABLE "company" ADD COLUMN "quality_automation_settings" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "manager_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capa" ADD COLUMN "repeat_ncr_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE TABLE "quality_reminder_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"recipient" text NOT NULL,
	"bucket" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX "quality_reminder_log_dedupe" ON "quality_reminder_log" USING btree ("kind","entity_type","entity_id","recipient","bucket");
