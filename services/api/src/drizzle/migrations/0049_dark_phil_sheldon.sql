CREATE TABLE "customer_scorecards" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"period" text,
	"quality_score" numeric,
	"delivery_score" numeric,
	"overall_score" numeric,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "customer_scorecards" ADD CONSTRAINT "customer_scorecards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_scorecards" ADD CONSTRAINT "customer_scorecards_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;