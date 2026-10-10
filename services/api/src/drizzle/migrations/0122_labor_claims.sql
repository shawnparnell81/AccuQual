-- Labor Claims. The claim number is typed on the record. This file does not
-- generate numbers and does not change Warranty.
-- Lists and reports keep working when this table is not here yet. Saving a
-- claim tells the person the database update has not run.
-- 0120 and 0121 are left open for the user-profile and order migrations.
-- This file is 0122.

CREATE TABLE IF NOT EXISTS "labor_claims" (
  "id" serial PRIMARY KEY,
  "claim_number" text,
  "claim_date" timestamp,
  "customer_name" text,
  "part_name" text,
  "labor_hours" numeric,
  "labor_rate" numeric,
  "total_labor_cost" numeric,
  "warranty_claim_id" integer REFERENCES "warranty_claims"("id"),
  "ncr_id" integer REFERENCES "ncr"("id"),
  "status" text NOT NULL DEFAULT 'open',
  "notes" text,
  "site_id" integer REFERENCES "sites"("id"),
  "created_by_user_id" integer REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "labor_claims_claim_number_key"
  ON "labor_claims" (lower(regexp_replace("claim_number", '[[:space:]]+', '', 'g')))
  WHERE "claim_number" IS NOT NULL AND btrim("claim_number") <> '';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "labor_claims_site_idx" ON "labor_claims" ("site_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "labor_claims_claim_date_idx" ON "labor_claims" ("claim_date");
--> statement-breakpoint
-- Same departments as Warranty. An administrator can change these rows later.
INSERT INTO "department_permissions" ("department_name", "module_name", "access_level")
VALUES
  ('customer_service', 'labor_claims', 'edit'),
  ('quality', 'labor_claims', 'edit'),
  ('engineering', 'labor_claims', 'edit'),
  ('purchasing', 'labor_claims', 'edit'),
  ('material_management', 'labor_claims', 'read')
ON CONFLICT ("department_name", "module_name") DO NOTHING;
