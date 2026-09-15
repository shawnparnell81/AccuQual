CREATE TABLE "qms_form_rows" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"form_id" integer NOT NULL,
	"section_key" text NOT NULL,
	"data" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "qms_forms" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"form_type" text NOT NULL,
	"form_no" text,
	"revision" text,
	"effective_date" timestamp,
	"prepared_by" text,
	"approved_by" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"additional_comments" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "qms_form_rows" ADD CONSTRAINT "qms_form_rows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qms_form_rows" ADD CONSTRAINT "qms_form_rows_form_id_qms_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."qms_forms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qms_forms" ADD CONSTRAINT "qms_forms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qms_forms" ADD CONSTRAINT "qms_forms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;