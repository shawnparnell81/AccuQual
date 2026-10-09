-- Login history for Admin → Login History.
-- Rows are kept for at least a year. This file does not delete them and does not schedule a purge.
-- The application ignores a missing table, so this can run after the code is deployed.
-- Passwords and tokens are not stored.

CREATE TABLE IF NOT EXISTS "login_events" (
  "id" serial PRIMARY KEY,
  "company_id" integer,
  "user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "email" text,
  "user_name" text,
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  "event_type" text NOT NULL,
  "success" boolean NOT NULL,
  "reason" text,
  "method" text,
  "ip_address" text,
  "location_city" text,
  "location_region" text,
  "location_country" text,
  "user_agent" text,
  "browser" text,
  "browser_version" text,
  "os" text,
  "device_type" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_events_company_occurred_idx" ON "login_events" ("company_id", "occurred_at" DESC);
--> statement-breakpoint
-- Default for the Administrator role, and for Owner so that account can open the page and assign it.
-- The check reads this list. A role name by itself does not grant the page.
UPDATE "roles"
SET "permissions" = "permissions" || '["login_history"]'::jsonb
WHERE "name" IN ('admin', 'owner')
  AND NOT ("permissions" ? 'login_history');
