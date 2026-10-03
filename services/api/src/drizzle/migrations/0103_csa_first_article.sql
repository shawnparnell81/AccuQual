-- Complete Strut Assembly first-article records.
-- New tables only. Existing FAI, NCR, workflow, and controlled-version tables are not altered.
-- 0101 is already applied. 0102 belongs to the NCR workflow change. This file is 0103.
CREATE TABLE IF NOT EXISTS "csa_fai_counters" (
  "year" integer PRIMARY KEY NOT NULL,
  "last_value" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "csa_fai_records" (
  "id" serial PRIMARY KEY NOT NULL,
  "number" text NOT NULL UNIQUE,
  "part_number" text NOT NULL,
  "part_description" text NOT NULL,
  "supplier_name" text NOT NULL,
  "supplier_id" integer REFERENCES "suppliers"("id"),
  "supplier_part_number" text NOT NULL,
  "sample_lot_number" text NOT NULL,
  "vehicle_year" text NOT NULL,
  "vehicle_make" text NOT NULL,
  "vehicle_model" text NOT NULL,
  "position" text NOT NULL,
  "inspector_name" text NOT NULL,
  "inspector_user_id" integer REFERENCES "users"("id"),
  "opened_by" integer REFERENCES "users"("id"),
  "date_opened" timestamp NOT NULL,
  "status" text NOT NULL,
  "stage" text NOT NULL,
  "product_family" text NOT NULL,
  "production_release" text DEFAULT 'No' NOT NULL,
  "approved_supplier" text DEFAULT 'No' NOT NULL,
  "ncr_required" text DEFAULT 'No' NOT NULL,
  "failure_detected" text DEFAULT 'No' NOT NULL,
  "ncr_id" integer REFERENCES "ncr"("id"),
  "workflow_id" integer REFERENCES "workflow_definitions"("id"),
  "workflow_run_id" integer REFERENCES "workflow_runs"("id"),
  "attempt_number" integer DEFAULT 1 NOT NULL,
  "locked" text DEFAULT 'No' NOT NULL,
  "sla_status" text,
  "rejection_reason" text,
  "rejected_by" text,
  "rejection_date" timestamp,
  "approval_date" timestamp,
  "approved_by" integer REFERENCES "users"("id"),
  "date_closed" timestamp,
  "packet" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp
);
