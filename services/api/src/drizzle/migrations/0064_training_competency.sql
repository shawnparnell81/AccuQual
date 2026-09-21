CREATE TABLE "training_competencies" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"course_id" integer NOT NULL,
	"session_id" integer,
	"evaluator_id" integer,
	"evaluation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"score" integer,
	"evaluated_at" timestamp,
	"expires_at" timestamp,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "training_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"course_id" integer NOT NULL,
	"title" text,
	"instructor_id" integer,
	"instructor_name" text,
	"location" text,
	"capacity" integer,
	"scheduled_at" timestamp NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"completed_at" timestamp,
	"attendance" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "training_assignments" ADD COLUMN "session_id" integer;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD COLUMN "document_version" integer;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "training_courses" ADD COLUMN "required_for_department" text;--> statement-breakpoint
ALTER TABLE "training_courses" ADD COLUMN "requirements" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "training_courses" ADD COLUMN "validity_months" integer;--> statement-breakpoint
ALTER TABLE "training_courses" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "training_courses" ADD COLUMN "updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "training_competencies" ADD CONSTRAINT "training_competencies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_competencies" ADD CONSTRAINT "training_competencies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_competencies" ADD CONSTRAINT "training_competencies_course_id_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_competencies" ADD CONSTRAINT "training_competencies_session_id_training_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."training_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_competencies" ADD CONSTRAINT "training_competencies_evaluator_id_users_id_fk" FOREIGN KEY ("evaluator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_competencies" ADD CONSTRAINT "training_competencies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_course_id_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_instructor_id_users_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_session_id_training_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."training_sessions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_status_check" CHECK ("status" IN ('scheduled', 'completed', 'cancelled'));--> statement-breakpoint
ALTER TABLE "training_competencies" ADD CONSTRAINT "training_competencies_status_check" CHECK ("status" IN ('pending', 'pass', 'fail'));--> statement-breakpoint
ALTER TABLE "training_competencies" ADD CONSTRAINT "training_competencies_score_check" CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= 100));--> statement-breakpoint
ALTER TABLE "training_courses" ADD CONSTRAINT "training_courses_validity_check" CHECK ("validity_months" IS NULL OR "validity_months" > 0);
