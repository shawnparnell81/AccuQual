-- Imported retailer reports, saved column maps, and the Imported Data folder.
-- 0122_labor_claims.sql and 0123_user_profile.sql are already on main.
-- This file is 0124, the next free number. Take the next free number again
-- at merge time. Never reuse a number.
-- Safe to deploy before this runs: existing imports still finish, and the
-- Imported Data list stays empty until the database update runs.

CREATE TABLE IF NOT EXISTS "import_column_maps" (
  "id" serial PRIMARY KEY,
  "entity_key" text NOT NULL UNIQUE,
  "header_map" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updated_by" integer REFERENCES "users"("id"),
  "updated_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "import_saves" (
  "id" serial PRIMARY KEY,
  "import_id" integer NOT NULL UNIQUE REFERENCES "data_imports"("id"),
  "display_name" text NOT NULL,
  "folder_id" integer REFERENCES "document_folders"("id"),
  "folder_node_id" integer REFERENCES "document_folders"("id"),
  "site_id" integer REFERENCES "sites"("id"),
  "saved_by" integer REFERENCES "users"("id"),
  "row_count" integer NOT NULL DEFAULT 0,
  "source_file_name" text NOT NULL DEFAULT '',
  "entity_key" text NOT NULL,
  "deleted_at" timestamp,
  "delete_reason" text,
  "deleted_by" integer REFERENCES "users"("id"),
  "restored_at" timestamp,
  "restore_reason" text,
  "restored_by" integer REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "import_saves_created_idx" ON "import_saves" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "import_saves_site_idx" ON "import_saves" ("site_id");

CREATE TABLE IF NOT EXISTS "import_parsed_rows" (
  "id" serial PRIMARY KEY,
  "import_id" integer NOT NULL REFERENCES "data_imports"("id"),
  "row_number" integer NOT NULL,
  "cells" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "mapped" jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS "import_parsed_rows_import_idx" ON "import_parsed_rows" ("import_id", "row_number");

INSERT INTO "document_folders" ("name", "parent_id", "sort_order")
SELECT 'Reports', iso."id", 80
FROM "document_folders" iso
WHERE iso."name" = 'ISO Compliance Documents' AND iso."parent_id" IS NULL
AND NOT EXISTS (
  SELECT 1 FROM "document_folders" child
  WHERE child."parent_id" = iso."id" AND child."name" = 'Reports'
);

INSERT INTO "document_folders" ("name", "parent_id", "sort_order")
SELECT 'Imported Data', reports."id", 0
FROM "document_folders" reports
JOIN "document_folders" iso ON reports."parent_id" = iso."id"
WHERE reports."name" = 'Reports' AND iso."name" = 'ISO Compliance Documents' AND iso."parent_id" IS NULL
AND NOT EXISTS (
  SELECT 1 FROM "document_folders" child
  WHERE child."parent_id" = reports."id" AND child."name" = 'Imported Data'
);

-- import_data is a role permission. These updates grant it on the role row.
-- Request handling still checks the permission, not the role name.
UPDATE "roles"
SET "permissions" = COALESCE("permissions", '[]'::jsonb) || '["import_data"]'::jsonb
WHERE NOT (COALESCE("permissions", '[]'::jsonb) @> '["import_data"]'::jsonb)
AND (
  lower("name") IN ('quality_manager', 'quality manager', 'engineering_manager', 'engineering manager')
);

INSERT INTO "roles" ("name", "description", "hierarchy_level", "is_protected", "permissions")
SELECT 'engineering_manager', 'Engineering Manager', 50, true, '["import_data"]'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM "roles" WHERE lower("name") IN ('engineering_manager', 'engineering manager')
);
