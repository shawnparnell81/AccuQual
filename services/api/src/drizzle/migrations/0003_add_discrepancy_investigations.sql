CREATE TABLE "discrepancy_investigations" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"severity" text,
	"status" text DEFAULT 'open' NOT NULL,
	"disposition" text,
	"auto_created" boolean DEFAULT false NOT NULL,
	"source_audit_id" integer,
	"source_audit_item_id" integer,
	"assigned_to" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "discrepancy_investigations" ADD CONSTRAINT "discrepancy_investigations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discrepancy_investigations" ADD CONSTRAINT "discrepancy_investigations_source_audit_id_audits_id_fk" FOREIGN KEY ("source_audit_id") REFERENCES "public"."audits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discrepancy_investigations" ADD CONSTRAINT "discrepancy_investigations_source_audit_item_id_audit_items_id_fk" FOREIGN KEY ("source_audit_item_id") REFERENCES "public"."audit_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discrepancy_investigations" ADD CONSTRAINT "discrepancy_investigations_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;