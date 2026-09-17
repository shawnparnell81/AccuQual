CREATE TABLE "inventory_lots" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"lot_number" text NOT NULL,
	"serial_number" text,
	"supplier_id" integer,
	"purchase_order_id" integer,
	"receiving_line_item_id" integer,
	"revision_level" text,
	"expiration_date" timestamp,
	"received_qty" numeric NOT NULL,
	"remaining_qty" numeric NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "receiving_settings" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "ncr" ADD COLUMN "supplier_id" integer;--> statement-breakpoint
ALTER TABLE "ncr" ADD COLUMN "receiving_line_item_id" integer;--> statement-breakpoint
ALTER TABLE "capa" ADD COLUMN "escalation_source" text;--> statement-breakpoint
ALTER TABLE "capa" ADD COLUMN "supplier_id" integer;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "lot_id" integer;--> statement-breakpoint
ALTER TABLE "erp_receiving_line_items" ADD COLUMN "status" text DEFAULT 'received' NOT NULL;--> statement-breakpoint
ALTER TABLE "erp_receiving_line_items" ADD COLUMN "lot_number" text;--> statement-breakpoint
ALTER TABLE "erp_receiving_line_items" ADD COLUMN "serial_number" text;--> statement-breakpoint
ALTER TABLE "quality_inspection_items" ADD COLUMN "spec_min" numeric;--> statement-breakpoint
ALTER TABLE "quality_inspection_items" ADD COLUMN "spec_max" numeric;--> statement-breakpoint
ALTER TABLE "quality_inspection_items" ADD COLUMN "actual_value" numeric;--> statement-breakpoint
ALTER TABLE "quality_inspection_items" ADD COLUMN "measurement_unit" text;--> statement-breakpoint
ALTER TABLE "quality_inspection_reports" ADD COLUMN "supplier_id" integer;--> statement-breakpoint
ALTER TABLE "quality_inspection_reports" ADD COLUMN "receiving_line_item_id" integer;--> statement-breakpoint
ALTER TABLE "quality_inspection_reports" ADD COLUMN "defect_category" text;--> statement-breakpoint
ALTER TABLE "quality_inspection_reports" ADD COLUMN "inspection_method" text;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_purchase_order_id_erp_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."erp_purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_receiving_line_item_id_erp_receiving_line_items_id_fk" FOREIGN KEY ("receiving_line_item_id") REFERENCES "public"."erp_receiving_line_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr" ADD CONSTRAINT "ncr_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capa" ADD CONSTRAINT "capa_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspection_reports" ADD CONSTRAINT "quality_inspection_reports_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspection_reports" ADD CONSTRAINT "quality_inspection_reports_receiving_line_item_id_erp_receiving_line_items_id_fk" FOREIGN KEY ("receiving_line_item_id") REFERENCES "public"."erp_receiving_line_items"("id") ON DELETE no action ON UPDATE no action;