ALTER TABLE "ai_risk_scores" ADD COLUMN "status" text DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_risk_scores" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD COLUMN "status" text DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD COLUMN "error_message" text;