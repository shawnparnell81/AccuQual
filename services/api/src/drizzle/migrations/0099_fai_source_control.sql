-- First article plans, numbered FAI records, part-supplier approval, and yearly pulls.
-- New tables only. Existing forms, NCR, quarantine, document control, validation sheets, and receiving are not altered.
CREATE TABLE IF NOT EXISTS "fai_inspection_plans" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "scope" text NOT NULL,
  "part_number" text,
  "part_name" text,
  "product_family" text,
  "supplier_id" integer REFERENCES "suppliers"("id"),
  "cadence_months" integer DEFAULT 6 NOT NULL,
  "current_revision" integer DEFAULT 1 NOT NULL,
  "notes" text,
  "retired_at" timestamp,
  "created_by" integer REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fai_plan_revisions" (
  "id" serial PRIMARY KEY NOT NULL,
  "plan_id" integer NOT NULL REFERENCES "fai_inspection_plans"("id"),
  "revision" integer NOT NULL,
  "cadence_months" integer NOT NULL,
  "scope" text NOT NULL,
  "part_number" text,
  "product_family" text,
  "supplier_id" integer REFERENCES "suppliers"("id"),
  "created_by" integer REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fai_plan_revisions_plan_revision_idx" ON "fai_plan_revisions" ("plan_id", "revision");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fai_plan_characteristics" (
  "id" serial PRIMARY KEY NOT NULL,
  "revision_id" integer NOT NULL REFERENCES "fai_plan_revisions"("id"),
  "sort_order" integer NOT NULL,
  "balloon" text,
  "name" text NOT NULL,
  "mode" text NOT NULL,
  "nominal" text,
  "percent" text,
  "plus_tolerance" text,
  "minus_tolerance" text,
  "spec_min" text,
  "spec_max" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fai_number_counters" (
  "year" integer PRIMARY KEY NOT NULL,
  "last_value" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fai_records" (
  "id" serial PRIMARY KEY NOT NULL,
  "number" text NOT NULL UNIQUE,
  "plan_id" integer NOT NULL REFERENCES "fai_inspection_plans"("id"),
  "revision_id" integer NOT NULL REFERENCES "fai_plan_revisions"("id"),
  "plan_revision" integer NOT NULL,
  "part_number" text NOT NULL,
  "part_name" text,
  "supplier_id" integer NOT NULL REFERENCES "suppliers"("id"),
  "supplier_name" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "comments" text,
  "assigned_to" integer REFERENCES "users"("id"),
  "opened_by" integer REFERENCES "users"("id"),
  "submitted_by" integer REFERENCES "users"("id"),
  "submitted_at" timestamp,
  "decided_by" integer REFERENCES "users"("id"),
  "decided_at" timestamp,
  "quality_signature" text,
  "outcome" text,
  "ncr_id" integer REFERENCES "ncr"("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fai_result_lines" (
  "id" serial PRIMARY KEY NOT NULL,
  "fai_id" integer NOT NULL REFERENCES "fai_records"("id"),
  "sort_order" integer NOT NULL,
  "balloon" text,
  "name" text NOT NULL,
  "mode" text NOT NULL,
  "nominal" text,
  "percent" text,
  "plus_tolerance" text,
  "minus_tolerance" text,
  "spec_min" text,
  "spec_max" text,
  "limit_low" text,
  "limit_high" text,
  "actual" text,
  "attribute_result" text,
  "result" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fai_source_approvals" (
  "id" serial PRIMARY KEY NOT NULL,
  "part_number" text NOT NULL,
  "supplier_id" integer NOT NULL REFERENCES "suppliers"("id"),
  "supplier_name" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "last_pass_date" text,
  "next_due_date" text,
  "cadence_months" integer DEFAULT 6 NOT NULL,
  "last_fai_id" integer REFERENCES "fai_records"("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fai_source_part_supplier_idx" ON "fai_source_approvals" ("part_number", "supplier_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fai_annual_pulls" (
  "id" serial PRIMARY KEY NOT NULL,
  "part_number" text NOT NULL,
  "assigned_to" integer REFERENCES "users"("id"),
  "assigned_at" timestamp,
  "completed_at" timestamp,
  "completed_by" integer REFERENCES "users"("id"),
  "fai_id" integer REFERENCES "fai_records"("id"),
  "notes" text,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fai_records_status_idx" ON "fai_records" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fai_result_lines_fai_idx" ON "fai_result_lines" ("fai_id", "sort_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fai_source_due_idx" ON "fai_source_approvals" ("next_due_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fai_annual_pulls_part_idx" ON "fai_annual_pulls" ("part_number", "completed_at");
--> statement-breakpoint
-- Default access for the new module. Does not change any existing permission row.
INSERT INTO "department_permissions" ("department_name", "module_name", "access_level")
VALUES ('quality', 'fai', 'edit'), ('engineering', 'fai', 'edit')
ON CONFLICT ("department_name", "module_name") DO NOTHING;
