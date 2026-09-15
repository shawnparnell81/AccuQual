CREATE TABLE "feasibility_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"source_type" text,
	"source_id" integer,
	"title" text NOT NULL,
	"description" text,
	"overall_score" numeric,
	"decision" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"department" text,
	"owner_id" integer,
	"reviewer_id" integer,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp,
	"decided_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "feasibility_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"feasibility_id" integer NOT NULL,
	"dimension_key" text NOT NULL,
	"dimension_label" text,
	"dimension_type" text,
	"value" numeric NOT NULL,
	"weight" numeric,
	"contribution" numeric,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "feasibility_reviews" ADD CONSTRAINT "feasibility_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feasibility_reviews" ADD CONSTRAINT "feasibility_reviews_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feasibility_reviews" ADD CONSTRAINT "feasibility_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feasibility_reviews" ADD CONSTRAINT "feasibility_reviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feasibility_scores" ADD CONSTRAINT "feasibility_scores_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feasibility_scores" ADD CONSTRAINT "feasibility_scores_feasibility_id_feasibility_reviews_id_fk" FOREIGN KEY ("feasibility_id") REFERENCES "public"."feasibility_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feasibility_scores" ADD CONSTRAINT "feasibility_scores_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;