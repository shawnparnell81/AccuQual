CREATE TABLE "document_change_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"document_change_request_id" integer NOT NULL,
	"change_id" text,
	"document_process" text,
	"current_revision" text,
	"proposed_revision" text,
	"reason" text,
	"requested_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "document_change_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
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
CREATE TABLE "document_change_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"document_change_request_id" integer NOT NULL,
	"reviewer" text,
	"comments" text,
	"decision" text,
	"review_date" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "document_change_items" ADD CONSTRAINT "document_change_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_change_items" ADD CONSTRAINT "document_change_items_document_change_request_id_document_change_requests_id_fk" FOREIGN KEY ("document_change_request_id") REFERENCES "public"."document_change_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_change_requests" ADD CONSTRAINT "document_change_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_change_requests" ADD CONSTRAINT "document_change_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_change_reviews" ADD CONSTRAINT "document_change_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_change_reviews" ADD CONSTRAINT "document_change_reviews_document_change_request_id_document_change_requests_id_fk" FOREIGN KEY ("document_change_request_id") REFERENCES "public"."document_change_requests"("id") ON DELETE no action ON UPDATE no action;