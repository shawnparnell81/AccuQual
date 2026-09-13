ALTER TABLE "tenants" ADD COLUMN "ai_usage_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ai_usage_cost" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ai_monthly_limit" integer;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ai_limit_enforced" boolean DEFAULT false NOT NULL;