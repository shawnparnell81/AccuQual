CREATE TABLE "erp_po_line_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"purchase_order_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost" numeric,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "erp_purchase_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "erp_receiving_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"purchase_order_id" integer NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "erp_receiving_line_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"receiving_document_id" integer NOT NULL,
	"po_line_item_id" integer NOT NULL,
	"quantity_received" integer NOT NULL,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "erp_po_line_items" ADD CONSTRAINT "erp_po_line_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_po_line_items" ADD CONSTRAINT "erp_po_line_items_purchase_order_id_erp_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."erp_purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_po_line_items" ADD CONSTRAINT "erp_po_line_items_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_purchase_orders" ADD CONSTRAINT "erp_purchase_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_purchase_orders" ADD CONSTRAINT "erp_purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_purchase_orders" ADD CONSTRAINT "erp_purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_receiving_documents" ADD CONSTRAINT "erp_receiving_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_receiving_documents" ADD CONSTRAINT "erp_receiving_documents_purchase_order_id_erp_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."erp_purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_receiving_documents" ADD CONSTRAINT "erp_receiving_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_receiving_line_items" ADD CONSTRAINT "erp_receiving_line_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_receiving_line_items" ADD CONSTRAINT "erp_receiving_line_items_receiving_document_id_erp_receiving_documents_id_fk" FOREIGN KEY ("receiving_document_id") REFERENCES "public"."erp_receiving_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erp_receiving_line_items" ADD CONSTRAINT "erp_receiving_line_items_po_line_item_id_erp_po_line_items_id_fk" FOREIGN KEY ("po_line_item_id") REFERENCES "public"."erp_po_line_items"("id") ON DELETE no action ON UPDATE no action;