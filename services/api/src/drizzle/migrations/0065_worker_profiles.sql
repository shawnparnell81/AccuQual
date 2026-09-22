CREATE TABLE "worker_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"job_title" text,
	"shift" text,
	"hire_date" timestamp,
	"skills" jsonb DEFAULT '[]'::jsonb,
	"employment_status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"updated_at" timestamp DEFAULT now(),
	"updated_by" integer,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "worker_profiles_tenant_user_unique" UNIQUE("tenant_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "worker_profiles" ADD CONSTRAINT "worker_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_profiles" ADD CONSTRAINT "worker_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_profiles" ADD CONSTRAINT "worker_profiles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_profiles" ADD CONSTRAINT "worker_profiles_employment_status_check" CHECK ("employment_status" IN ('active', 'on_leave', 'terminated'));