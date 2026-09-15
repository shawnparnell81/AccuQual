CREATE TABLE "warranty_claim_costs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"claim_id" integer NOT NULL,
	"cost_type" text NOT NULL,
	"amount" numeric NOT NULL,
	"notes" text,
	"recorded_by_user_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "warranty_claim_workflow" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"claim_id" integer NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"note" text,
	"performed_by_user_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "warranty_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"claim_number" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"customer_id" integer,
	"product_id" integer,
	"serial_number" text,
	"purchase_date" timestamp,
	"failure_date" timestamp,
	"failure_description" text,
	"failure_images" jsonb DEFAULT '[]'::jsonb,
	"documents" jsonb DEFAULT '[]'::jsonb,
	"warranty_cost_estimate" numeric,
	"warranty_actual_cost" numeric,
	"supplier_id" integer,
	"linked_ncr_id" integer,
	"linked_work_order_id" integer,
	"inspection_notes" text,
	"inspected_by_user_id" integer,
	"inspection_date" timestamp,
	"supplier_review_notes" text,
	"disposition_notes" text,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp,
	CONSTRAINT "warranty_claims_claim_number_unique" UNIQUE("claim_number")
);
--> statement-breakpoint
CREATE TABLE "supplier_8d_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"linked_ncr_id" integer,
	"linked_eight_d_id" integer,
	"status" text DEFAULT 'submitted' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb,
	"supporting_documents" jsonb DEFAULT '[]'::jsonb,
	"review_notes" text,
	"reviewed_by_user_id" integer,
	"submitted_by_user_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "supplier_corrective_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"linked_ncr_id" integer,
	"linked_capa_id" integer,
	"status" text DEFAULT 'submitted' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb,
	"supporting_documents" jsonb DEFAULT '[]'::jsonb,
	"review_notes" text,
	"reviewed_by_user_id" integer,
	"submitted_by_user_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "supplier_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"file_name" text NOT NULL,
	"file_path" text NOT NULL,
	"mime_type" text,
	"file_size" integer,
	"uploaded_by_user_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "supplier_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"thread_key" text DEFAULT 'general' NOT NULL,
	"sender_role" text NOT NULL,
	"sender_user_id" integer,
	"body" text NOT NULL,
	"attachment" jsonb,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "supplier_onboarding_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"document_type" text NOT NULL,
	"file_name" text NOT NULL,
	"file_path" text NOT NULL,
	"mime_type" text,
	"file_size" integer,
	"status" text DEFAULT 'submitted' NOT NULL,
	"review_notes" text,
	"reviewed_by_user_id" integer,
	"uploaded_by_user_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "supplier_ppap_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"level" integer NOT NULL,
	"part_number" text,
	"description" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"documents" jsonb DEFAULT '{}'::jsonb,
	"review_notes" text,
	"reviewed_by_user_id" integer,
	"submitted_by_user_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "supplier_id" integer;--> statement-breakpoint
ALTER TABLE "warranty_claim_costs" ADD CONSTRAINT "warranty_claim_costs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claim_costs" ADD CONSTRAINT "warranty_claim_costs_claim_id_warranty_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."warranty_claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claim_costs" ADD CONSTRAINT "warranty_claim_costs_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claim_workflow" ADD CONSTRAINT "warranty_claim_workflow_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claim_workflow" ADD CONSTRAINT "warranty_claim_workflow_claim_id_warranty_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."warranty_claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claim_workflow" ADD CONSTRAINT "warranty_claim_workflow_performed_by_user_id_users_id_fk" FOREIGN KEY ("performed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_product_id_inventory_items_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_linked_ncr_id_ncr_id_fk" FOREIGN KEY ("linked_ncr_id") REFERENCES "public"."ncr"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_linked_work_order_id_work_orders_id_fk" FOREIGN KEY ("linked_work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_inspected_by_user_id_users_id_fk" FOREIGN KEY ("inspected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_8d_responses" ADD CONSTRAINT "supplier_8d_responses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_8d_responses" ADD CONSTRAINT "supplier_8d_responses_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_8d_responses" ADD CONSTRAINT "supplier_8d_responses_linked_ncr_id_ncr_id_fk" FOREIGN KEY ("linked_ncr_id") REFERENCES "public"."ncr"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_8d_responses" ADD CONSTRAINT "supplier_8d_responses_linked_eight_d_id_eight_d_id_fk" FOREIGN KEY ("linked_eight_d_id") REFERENCES "public"."eight_d"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_8d_responses" ADD CONSTRAINT "supplier_8d_responses_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_8d_responses" ADD CONSTRAINT "supplier_8d_responses_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_corrective_actions" ADD CONSTRAINT "supplier_corrective_actions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_corrective_actions" ADD CONSTRAINT "supplier_corrective_actions_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_corrective_actions" ADD CONSTRAINT "supplier_corrective_actions_linked_ncr_id_ncr_id_fk" FOREIGN KEY ("linked_ncr_id") REFERENCES "public"."ncr"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_corrective_actions" ADD CONSTRAINT "supplier_corrective_actions_linked_capa_id_capa_id_fk" FOREIGN KEY ("linked_capa_id") REFERENCES "public"."capa"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_corrective_actions" ADD CONSTRAINT "supplier_corrective_actions_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_corrective_actions" ADD CONSTRAINT "supplier_corrective_actions_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_documents" ADD CONSTRAINT "supplier_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_documents" ADD CONSTRAINT "supplier_documents_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_documents" ADD CONSTRAINT "supplier_documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_messages" ADD CONSTRAINT "supplier_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_messages" ADD CONSTRAINT "supplier_messages_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_messages" ADD CONSTRAINT "supplier_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_onboarding_documents" ADD CONSTRAINT "supplier_onboarding_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_onboarding_documents" ADD CONSTRAINT "supplier_onboarding_documents_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_onboarding_documents" ADD CONSTRAINT "supplier_onboarding_documents_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_onboarding_documents" ADD CONSTRAINT "supplier_onboarding_documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_ppap_submissions" ADD CONSTRAINT "supplier_ppap_submissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_ppap_submissions" ADD CONSTRAINT "supplier_ppap_submissions_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_ppap_submissions" ADD CONSTRAINT "supplier_ppap_submissions_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_ppap_submissions" ADD CONSTRAINT "supplier_ppap_submissions_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;