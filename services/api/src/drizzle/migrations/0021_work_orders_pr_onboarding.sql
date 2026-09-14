CREATE TABLE "erp_purchase_requisitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"requested_by" integer,
	"department" text,
	"item_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"supplier_id" integer,
	"linked_ncr_id" integer,
	"justification" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp,
	"purchase_order_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"quantity_planned" numeric NOT NULL,
	"quantity_completed" numeric DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"linked_ncr_id" integer,
	"due_date" timestamp,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "onboarding_progress" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"module_key" text NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "erp_purchase_requisitions" ADD CONSTRAINT "erp_purchase_requisitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_purchase_requisitions" ADD CONSTRAINT "erp_purchase_requisitions_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_purchase_requisitions" ADD CONSTRAINT "erp_purchase_requisitions_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_purchase_requisitions" ADD CONSTRAINT "erp_purchase_requisitions_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_purchase_requisitions" ADD CONSTRAINT "erp_purchase_requisitions_linked_ncr_id_ncr_id_fk" FOREIGN KEY ("linked_ncr_id") REFERENCES "public"."ncr"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_purchase_requisitions" ADD CONSTRAINT "erp_purchase_requisitions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_purchase_requisitions" ADD CONSTRAINT "erp_purchase_requisitions_purchase_order_id_erp_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."erp_purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_linked_ncr_id_ncr_id_fk" FOREIGN KEY ("linked_ncr_id") REFERENCES "public"."ncr"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;