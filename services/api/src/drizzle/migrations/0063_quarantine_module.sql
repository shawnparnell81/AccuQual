CREATE TABLE "quarantine_inventory" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"quarantine_id" integer NOT NULL,
	"location" text NOT NULL,
	"quantity" numeric NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "quarantine_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"item_type" text NOT NULL,
	"item_id" integer,
	"item_label" text NOT NULL,
	"lot_number" text,
	"quantity" numeric NOT NULL,
	"original_quantity" numeric NOT NULL,
	"unit" text,
	"reason_category" text DEFAULT 'other' NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'quarantined' NOT NULL,
	"enforced" boolean DEFAULT false NOT NULL,
	"source_type" text,
	"source_id" integer,
	"ncr_id" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp,
	"released_at" timestamp,
	"destroyed_at" timestamp,
	"closed_by" integer
);
--> statement-breakpoint
CREATE TABLE "quarantine_resolutions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"quarantine_id" integer NOT NULL,
	"action" text NOT NULL,
	"disposition" text NOT NULL,
	"quantity" numeric NOT NULL,
	"notes" text NOT NULL,
	"resolved_by" integer,
	"resolved_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "held_qty" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD COLUMN "held_qty" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "quarantine_inventory" ADD CONSTRAINT "quarantine_inventory_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarantine_inventory" ADD CONSTRAINT "quarantine_inventory_quarantine_id_quarantine_records_id_fk" FOREIGN KEY ("quarantine_id") REFERENCES "public"."quarantine_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarantine_records" ADD CONSTRAINT "quarantine_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarantine_records" ADD CONSTRAINT "quarantine_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarantine_records" ADD CONSTRAINT "quarantine_records_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarantine_resolutions" ADD CONSTRAINT "quarantine_resolutions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarantine_resolutions" ADD CONSTRAINT "quarantine_resolutions_quarantine_id_quarantine_records_id_fk" FOREIGN KEY ("quarantine_id") REFERENCES "public"."quarantine_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarantine_resolutions" ADD CONSTRAINT "quarantine_resolutions_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quarantine_records" ADD CONSTRAINT "quarantine_records_status_check" CHECK ("status" IN ('quarantined', 'released', 'destroyed'));--> statement-breakpoint
ALTER TABLE "quarantine_records" ADD CONSTRAINT "quarantine_records_item_type_check" CHECK ("item_type" IN ('inventory_lot', 'inventory_item', 'finished_goods', 'work_in_process', 'equipment', 'other'));--> statement-breakpoint
ALTER TABLE "quarantine_records" ADD CONSTRAINT "quarantine_records_quantity_check" CHECK ("quantity" >= 0 AND "original_quantity" > 0);--> statement-breakpoint
ALTER TABLE "quarantine_inventory" ADD CONSTRAINT "quarantine_inventory_quantity_check" CHECK ("quantity" >= 0);--> statement-breakpoint
ALTER TABLE "quarantine_resolutions" ADD CONSTRAINT "quarantine_resolutions_action_check" CHECK ("action" IN ('release', 'destroy'));--> statement-breakpoint
ALTER TABLE "quarantine_resolutions" ADD CONSTRAINT "quarantine_resolutions_quantity_check" CHECK ("quantity" > 0);--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_held_qty_check" CHECK ("held_qty" >= 0);--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_held_qty_check" CHECK ("held_qty" >= 0);
