CREATE TABLE "scar_forms" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"scar_number" text,
	"date_issued" timestamp,
	"supplier_name" text,
	"response_due_date" timestamp,
	"contact_person" text,
	"po_number" text,
	"part_number_description" text,
	"lot_heat_number" text,
	"quantity_inspected" text,
	"quantity_rejected" text,
	"defect_description" text,
	"quarantine_at_supplier" boolean DEFAULT false NOT NULL,
	"quarantine_in_transit" boolean DEFAULT false NOT NULL,
	"quarantine_at_customer_site" boolean DEFAULT false NOT NULL,
	"containment_plan" text,
	"why_1" text,
	"why_2" text,
	"why_3" text,
	"why_4" text,
	"why_5" text,
	"corrective_action_owner" text,
	"corrective_action_target_date" timestamp,
	"preventive_action_owner" text,
	"preventive_action_target_date" timestamp,
	"process_update_owner" text,
	"process_update_target_date" timestamp,
	"supplier_rep_signature" text,
	"supplier_rep_date" timestamp,
	"quality_engineer_signature" text,
	"quality_engineer_date" timestamp,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "quality_inspection_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"report_id" integer NOT NULL,
	"item_number" numeric,
	"parameter" text,
	"specification" text,
	"actual_finding" text,
	"result" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "quality_inspection_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"inspection_date" timestamp,
	"inspector_name" text,
	"inspection_type" text,
	"part_material_no" text,
	"po_job_no" text,
	"supplier_vendor" text,
	"batch_lot_no" text,
	"total_quantity" text,
	"sample_size" text,
	"final_status" text,
	"notes_remarks" text,
	"inspector_signature" text,
	"inspector_signature_date" timestamp,
	"qa_lead_signature" text,
	"qa_lead_signature_date" timestamp,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "scar_forms" ADD CONSTRAINT "scar_forms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scar_forms" ADD CONSTRAINT "scar_forms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspection_items" ADD CONSTRAINT "quality_inspection_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspection_items" ADD CONSTRAINT "quality_inspection_items_report_id_quality_inspection_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."quality_inspection_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspection_reports" ADD CONSTRAINT "quality_inspection_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_inspection_reports" ADD CONSTRAINT "quality_inspection_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;