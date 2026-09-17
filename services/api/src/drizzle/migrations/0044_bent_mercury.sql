CREATE TABLE "supplier_quality_risk_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"score_date" date NOT NULL,
	"score" numeric NOT NULL,
	"band" text NOT NULL,
	"formula_version" text DEFAULT 'v1' NOT NULL,
	"breakdown" jsonb NOT NULL,
	"computed_by_user_id" integer,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "supplier_quality_risk_scores_supplier_date_unique" UNIQUE("supplier_id","score_date")
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "supplier_risk_weights" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp;--> statement-breakpoint
ALTER TABLE "scar_forms" ADD COLUMN "supplier_id" integer;--> statement-breakpoint
ALTER TABLE "supplier_messages" ADD COLUMN "category" text DEFAULT 'message' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_messages" ADD COLUMN "ai_drafted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_quality_risk_scores" ADD CONSTRAINT "supplier_quality_risk_scores_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quality_risk_scores" ADD CONSTRAINT "supplier_quality_risk_scores_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quality_risk_scores" ADD CONSTRAINT "supplier_quality_risk_scores_computed_by_user_id_users_id_fk" FOREIGN KEY ("computed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scar_forms" ADD CONSTRAINT "scar_forms_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;