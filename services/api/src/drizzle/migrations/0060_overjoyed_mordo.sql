CREATE TABLE "controlled_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"payload" jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"based_on_version" integer,
	"is_rollback" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_by" integer,
	"updated_at" timestamp,
	"submitted_by" integer,
	"submitted_at" timestamp,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"review_decision" text,
	"review_notes" text,
	"published_by" integer,
	"published_at" timestamp,
	CONSTRAINT "controlled_versions_subject_number_uq" UNIQUE("tenant_id","subject_type","subject_id","version_number")
);
--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "definition_version" integer;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "current_node_id" text;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "run_state" jsonb;--> statement-breakpoint
ALTER TABLE "controlled_versions" ADD CONSTRAINT "controlled_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controlled_versions" ADD CONSTRAINT "controlled_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controlled_versions" ADD CONSTRAINT "controlled_versions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controlled_versions" ADD CONSTRAINT "controlled_versions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controlled_versions" ADD CONSTRAINT "controlled_versions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controlled_versions" ADD CONSTRAINT "controlled_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "controlled_versions_one_open_uq" ON "controlled_versions" USING btree ("tenant_id","subject_type","subject_id") WHERE status in ('draft', 'in_review');