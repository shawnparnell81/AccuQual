ALTER TABLE "workflow_definitions" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD COLUMN "version_history" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "simulated" boolean DEFAULT false NOT NULL;