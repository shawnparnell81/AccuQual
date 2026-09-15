CREATE TABLE "risk_mitigations" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"risk_assessment_id" integer NOT NULL,
	"action" text NOT NULL,
	"due_date" timestamp,
	"owner_id" integer,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD COLUMN "source_type" text;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD COLUMN "source_id" integer;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD COLUMN "severity" integer;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD COLUMN "probability" integer;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD COLUMN "risk_score" integer;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD COLUMN "risk_level" text;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD COLUMN "department" text;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD COLUMN "created_by" integer;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD COLUMN "updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD COLUMN "closed_at" timestamp;--> statement-breakpoint
ALTER TABLE "risk_mitigations" ADD CONSTRAINT "risk_mitigations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_mitigations" ADD CONSTRAINT "risk_mitigations_risk_assessment_id_risk_assessments_id_fk" FOREIGN KEY ("risk_assessment_id") REFERENCES "public"."risk_assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_mitigations" ADD CONSTRAINT "risk_mitigations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_mitigations" ADD CONSTRAINT "risk_mitigations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;