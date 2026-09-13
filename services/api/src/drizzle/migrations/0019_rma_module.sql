CREATE TABLE "rma" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"rma_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"supplier_id" integer NOT NULL,
	"reason_code" text,
	"linked_ncr_id" integer,
	"linked_capa_id" integer,
	"created_by_user_id" integer,
	"approved_by_user_id" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp,
	CONSTRAINT "rma_rma_number_unique" UNIQUE("rma_number")
);
--> statement-breakpoint
CREATE TABLE "rma_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"rma_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"description" text,
	"quantity_returned" numeric NOT NULL,
	"unit_of_measure" text,
	"reason" text,
	"supplier_response" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "rma" ADD CONSTRAINT "rma_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rma" ADD CONSTRAINT "rma_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rma" ADD CONSTRAINT "rma_linked_ncr_id_ncr_id_fk" FOREIGN KEY ("linked_ncr_id") REFERENCES "public"."ncr"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rma" ADD CONSTRAINT "rma_linked_capa_id_capa_id_fk" FOREIGN KEY ("linked_capa_id") REFERENCES "public"."capa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rma" ADD CONSTRAINT "rma_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rma" ADD CONSTRAINT "rma_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rma_items" ADD CONSTRAINT "rma_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rma_items" ADD CONSTRAINT "rma_items_rma_id_rma_id_fk" FOREIGN KEY ("rma_id") REFERENCES "public"."rma"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rma_items" ADD CONSTRAINT "rma_items_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;