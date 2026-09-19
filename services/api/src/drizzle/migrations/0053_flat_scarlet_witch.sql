CREATE TABLE "erp_sync_errors" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"module" text NOT NULL,
	"preset_id" integer,
	"preset_version" integer,
	"direction" text DEFAULT 'outbound' NOT NULL,
	"error_type" text NOT NULL,
	"message" text NOT NULL,
	"details" jsonb,
	"payload_snapshot" jsonb,
	"created_at" timestamp DEFAULT now(),
	"resolved_at" timestamp,
	"resolved_by" integer
);
--> statement-breakpoint
ALTER TABLE "erp_sync_errors" ADD CONSTRAINT "erp_sync_errors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_sync_errors" ADD CONSTRAINT "erp_sync_errors_preset_id_erp_connector_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."erp_connector_presets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_sync_errors" ADD CONSTRAINT "erp_sync_errors_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;