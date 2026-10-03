-- Fuel Pump Module first-article records.
-- New tables only. Existing FAI, CSA, NCR, workflow, and controlled-version tables are not altered.
-- 0101, 0102, and 0103 already ran. This file is 0104.
-- The workflow row is created inactive, and its controlled version is a draft, by the app.
-- This migration does not publish a version.
CREATE TABLE IF NOT EXISTS "fuel_pump_fai_counters" (
  "year" integer PRIMARY KEY NOT NULL,
  "last_value" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fuel_pump_fai_records" (
  "id" serial PRIMARY KEY NOT NULL,
  "fai_number" text NOT NULL UNIQUE,
  "part_number" text NOT NULL,
  "part_description" text DEFAULT '' NOT NULL,
  "supplier" text NOT NULL,
  "supplier_id" integer REFERENCES "suppliers"("id"),
  "supplier_part_number" text DEFAULT '' NOT NULL,
  "sample_lot_number" text NOT NULL,
  "vehicle_year" text DEFAULT '' NOT NULL,
  "vehicle_make" text DEFAULT '' NOT NULL,
  "vehicle_model" text DEFAULT '' NOT NULL,
  "vehicle_engine" text DEFAULT '' NOT NULL,
  "application" text NOT NULL,
  "inspector" text NOT NULL,
  "inspector_user_id" integer REFERENCES "users"("id"),
  "validation_owner" text DEFAULT '' NOT NULL,
  "quality_manager" text DEFAULT '' NOT NULL,
  "opened_by" integer REFERENCES "users"("id"),
  "status" text NOT NULL,
  "workflow_stage" text NOT NULL,
  "overall_result" text,
  "flow_rate_result" text,
  "pressure_result" text,
  "current_draw_result" text,
  "electrical_result" text,
  "fitment_result" text,
  "packaging_result" text,
  "failure_detected" text DEFAULT 'No' NOT NULL,
  "ncr_required" text DEFAULT 'No' NOT NULL,
  "linked_ncr" integer REFERENCES "ncr"("id"),
  "production_release" text DEFAULT 'No' NOT NULL,
  "date_opened" timestamp NOT NULL,
  "date_closed" timestamp,
  "sla_status" text,
  "workflow_id" integer REFERENCES "workflow_definitions"("id"),
  "workflow_run_id" integer REFERENCES "workflow_runs"("id"),
  "attempt_number" integer DEFAULT 1 NOT NULL,
  "locked" text DEFAULT 'No' NOT NULL,
  "rejection_reason" text,
  "rejected_by" text,
  "rejection_date" timestamp,
  "approval_date" timestamp,
  "approved_by" integer REFERENCES "users"("id"),
  "packet" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp
);
