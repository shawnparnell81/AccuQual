CREATE TABLE "rma_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"rma_number" text NOT NULL,
	"date_issued" timestamp DEFAULT now() NOT NULL,
	"tracking_number" text,
	"customer_name" text,
	"part_number" text,
	"part_description" text,
	"quantity_returned" numeric,
	"original_order_number" text,
	"serial_number" text,
	"customer_reason_for_return" text,
	"date_received" timestamp,
	"quality_team_findings" text,
	"disposition_action" text,
	"corrective_action" text,
	"credit_memo" text,
	"date_closed" timestamp,
	"warranty_id" integer,
	"supplier_rma_request_id" integer,
	"quality_id" integer,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "rma_log" ADD CONSTRAINT "rma_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rma_log" ADD CONSTRAINT "rma_log_warranty_id_warranty_claims_id_fk" FOREIGN KEY ("warranty_id") REFERENCES "public"."warranty_claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rma_log" ADD CONSTRAINT "rma_log_supplier_rma_request_id_supplier_rma_requests_id_fk" FOREIGN KEY ("supplier_rma_request_id") REFERENCES "public"."supplier_rma_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rma_log" ADD CONSTRAINT "rma_log_quality_id_ncr_id_fk" FOREIGN KEY ("quality_id") REFERENCES "public"."ncr"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rma_log" ADD CONSTRAINT "rma_log_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rma_log_tenant_rma_number_idx" ON "rma_log" USING btree ("tenant_id","rma_number");