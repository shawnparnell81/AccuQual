ALTER TABLE "complaints" ADD COLUMN "resolution" text;--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "resolved_at" timestamp;--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN "closed_at" timestamp;