ALTER TABLE "erp_connector_presets" ADD COLUMN "is_builtin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "erp_connector_presets" SET "is_builtin" = true WHERE "tenant_id" IS NULL;
