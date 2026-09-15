ALTER TABLE "tenants" ADD COLUMN "feasibility_settings" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "inventory_settings" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "erp_sync_settings" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "feasibility_reviews" ADD COLUMN "risk_level" text;--> statement-breakpoint
ALTER TABLE "feasibility_reviews" ADD COLUMN "risk_level_set_manually" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "feasibility_reviews" ADD COLUMN "provided_documents" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "feasibility_reviews" ADD COLUMN "customer_requirement" text;--> statement-breakpoint
ALTER TABLE "feasibility_reviews" ADD COLUMN "mapped_requirement_category" text;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "last_counted_at" timestamp;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "lot_number" text;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "serial_number" text;--> statement-breakpoint
ALTER TABLE "inventory_stock" ADD COLUMN "allocated_at" timestamp;