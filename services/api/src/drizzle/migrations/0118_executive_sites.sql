-- Greer and Wellman, site on records that did not have one, and the
-- executive dashboard. Existing rows keep a null site and show as Unassigned.
-- Nothing here assigns a site onto records that already exist.
-- New columns and the layout table are optional until this runs: callers
-- that need them use a savepoint and keep working when the column is absent.
-- This file does not create user accounts.

INSERT INTO "sites" ("name", "code", "status", "is_default")
SELECT 'Greer', 'greer', 'active', false
WHERE NOT EXISTS (
  SELECT 1 FROM "sites"
  WHERE "deleted_at" IS NULL AND "status" = 'active' AND lower("name") = 'greer'
);
--> statement-breakpoint
INSERT INTO "sites" ("name", "code", "status", "is_default")
SELECT 'Wellman', 'wellman', 'active', false
WHERE NOT EXISTS (
  SELECT 1 FROM "sites"
  WHERE "deleted_at" IS NULL AND "status" = 'active' AND lower("name") = 'wellman'
);
--> statement-breakpoint
ALTER TABLE "complaints" ADD COLUMN IF NOT EXISTS "site_id" integer REFERENCES "sites"("id");
--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD COLUMN IF NOT EXISTS "site_id" integer REFERENCES "sites"("id");
--> statement-breakpoint
ALTER TABLE "validation_reports" ADD COLUMN IF NOT EXISTS "site_id" integer REFERENCES "sites"("id");
--> statement-breakpoint
ALTER TABLE "iso_quality_forms" ADD COLUMN IF NOT EXISTS "site_id" integer REFERENCES "sites"("id");
--> statement-breakpoint
ALTER TABLE "qms_forms" ADD COLUMN IF NOT EXISTS "site_id" integer REFERENCES "sites"("id");
--> statement-breakpoint
ALTER TABLE "built_form_fills" ADD COLUMN IF NOT EXISTS "site_id" integer REFERENCES "sites"("id");
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "site_scope" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "executive_dashboard_layouts" (
  "user_id" integer PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "layout" jsonb NOT NULL,
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
INSERT INTO "roles" ("name", "description", "hierarchy_level", "is_protected", "permissions")
VALUES (
  'executive',
  'Executive — view every site and the executive dashboard. Does not grant editing.',
  18,
  true,
  '["sites.view_all","executive.dashboard"]'::jsonb
)
ON CONFLICT ("name") DO UPDATE SET
  "is_protected" = true,
  "description" = EXCLUDED."description",
  "permissions" = (
    SELECT COALESCE(jsonb_agg(DISTINCT item), '[]'::jsonb)
    FROM (
      SELECT jsonb_array_elements_text(COALESCE("roles"."permissions", '[]'::jsonb)) AS item
      UNION
      SELECT jsonb_array_elements_text(EXCLUDED."permissions")
    ) merged
  );
