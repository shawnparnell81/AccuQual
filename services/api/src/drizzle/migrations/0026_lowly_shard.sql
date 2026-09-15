CREATE TABLE "work_order_operations" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"work_order_id" integer NOT NULL,
	"op_number" integer NOT NULL,
	"description" text NOT NULL,
	"work_center" text,
	"completed_qty" numeric,
	"sign_off" text,
	"sign_off_date" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "revision" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "first_piece_inspection_passed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "final_qc_inspection_passed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "operator_signature" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "operator_signed_at" timestamp;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "inspector_signature" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "inspector_signed_at" timestamp;--> statement-breakpoint
ALTER TABLE "work_order_operations" ADD CONSTRAINT "work_order_operations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_operations" ADD CONSTRAINT "work_order_operations_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;