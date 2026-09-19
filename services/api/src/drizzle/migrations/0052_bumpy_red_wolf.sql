CREATE TABLE "erp_connector_presets" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"vendor" text NOT NULL,
	"module" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"direction" text DEFAULT 'push' NOT NULL,
	"mapping_config" jsonb DEFAULT '{"fieldMappings":[],"triggers":[],"validationRules":[]}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"version_history" jsonb DEFAULT '[]'::jsonb,
	"is_active" boolean DEFAULT false NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "erp_connector_presets" ADD CONSTRAINT "erp_connector_presets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_connector_presets" ADD CONSTRAINT "erp_connector_presets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;