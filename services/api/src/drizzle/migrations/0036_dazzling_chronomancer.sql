CREATE TABLE "rma_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"rma_id" integer,
	"supplier_rma_request_id" integer,
	"event" text NOT NULL,
	"details" jsonb,
	"performed_by" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "supplier_rma_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"company_name" text NOT NULL,
	"contact_name" text NOT NULL,
	"email" text NOT NULL,
	"phone_number" text,
	"po_number" text,
	"part_number" text,
	"po_date" timestamp,
	"customer_claim_number" text,
	"short_description" text,
	"description" text,
	"created_rma_id" integer,
	"submitted_by_user_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crar" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"warranty_id" integer,
	"quality_id" integer,
	"supplier_rma_request_id" integer,
	"linked_rma_id" integer,
	"customer_name" text,
	"rma_number" text,
	"customer_claim" text,
	"part_number" text,
	"part_description" text,
	"qty_returned" text,
	"report_initiated_by" text,
	"report_date" timestamp,
	"approved_by" text,
	"customer_complaint" text,
	"complaint_detail" text,
	"date_received" timestamp,
	"received_by" text,
	"condition_on_receipt" text,
	"assessment_damage" boolean DEFAULT false NOT NULL,
	"assessment_missing" boolean DEFAULT false NOT NULL,
	"assessment_contamination" boolean DEFAULT false NOT NULL,
	"assessment_packaging" boolean DEFAULT false NOT NULL,
	"assessment_mismatch" boolean DEFAULT false NOT NULL,
	"assessment_other" boolean DEFAULT false NOT NULL,
	"initial_assessment_notes" text,
	"investigation_plan" text,
	"investigator" text,
	"target_completion" timestamp,
	"priority" text,
	"evidence_notes" text,
	"drawing_spec_no" text,
	"drawing_revision" text,
	"applicable_requirement" text,
	"acceptance_criteria" text,
	"test_results" text,
	"tested_by" text,
	"test_date" timestamp,
	"overall_test_result" text,
	"findings" text,
	"root_cause" text,
	"conclusion" text,
	"warranty_accepted" boolean DEFAULT false NOT NULL,
	"warranty_denied" boolean DEFAULT false NOT NULL,
	"accepted_disposition" text,
	"denied_reason" text,
	"disposition_explanation" text,
	"corrective_action_required" boolean DEFAULT false NOT NULL,
	"engineering_review_required" boolean DEFAULT false NOT NULL,
	"car_number" text,
	"customer_communication_date" timestamp,
	"disposition_date" timestamp,
	"final_review_comments" text,
	"prepared_by_final" text,
	"prepared_signature" text,
	"prepared_date" timestamp,
	"approved_by_final" text,
	"approved_signature" text,
	"approved_date" timestamp,
	"record_location" text,
	"retention_class" text,
	"record_closed" boolean DEFAULT false NOT NULL,
	"customer_notified" boolean DEFAULT false NOT NULL,
	"additional_notes" text,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "rma" ADD COLUMN "linked_po_id" integer;--> statement-breakpoint
ALTER TABLE "rma_log" ADD CONSTRAINT "rma_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rma_log" ADD CONSTRAINT "rma_log_rma_id_rma_id_fk" FOREIGN KEY ("rma_id") REFERENCES "public"."rma"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rma_log" ADD CONSTRAINT "rma_log_supplier_rma_request_id_supplier_rma_requests_id_fk" FOREIGN KEY ("supplier_rma_request_id") REFERENCES "public"."supplier_rma_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rma_log" ADD CONSTRAINT "rma_log_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_rma_requests" ADD CONSTRAINT "supplier_rma_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_rma_requests" ADD CONSTRAINT "supplier_rma_requests_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_rma_requests" ADD CONSTRAINT "supplier_rma_requests_created_rma_id_rma_id_fk" FOREIGN KEY ("created_rma_id") REFERENCES "public"."rma"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_rma_requests" ADD CONSTRAINT "supplier_rma_requests_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crar" ADD CONSTRAINT "crar_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crar" ADD CONSTRAINT "crar_warranty_id_warranty_claims_id_fk" FOREIGN KEY ("warranty_id") REFERENCES "public"."warranty_claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crar" ADD CONSTRAINT "crar_quality_id_ncr_id_fk" FOREIGN KEY ("quality_id") REFERENCES "public"."ncr"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crar" ADD CONSTRAINT "crar_supplier_rma_request_id_supplier_rma_requests_id_fk" FOREIGN KEY ("supplier_rma_request_id") REFERENCES "public"."supplier_rma_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crar" ADD CONSTRAINT "crar_linked_rma_id_rma_id_fk" FOREIGN KEY ("linked_rma_id") REFERENCES "public"."rma"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crar" ADD CONSTRAINT "crar_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rma" ADD CONSTRAINT "rma_linked_po_id_erp_purchase_orders_id_fk" FOREIGN KEY ("linked_po_id") REFERENCES "public"."erp_purchase_orders"("id") ON DELETE no action ON UPDATE no action;