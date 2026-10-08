-- Delete a plant without removing the row. Records keep their foreign key,
-- and the name frozen at deletion is what history shows. Inactive plants
-- (the old Deactivate action) are treated as deleted. The code unique index
-- ignores those rows so the same code can be added again.
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "name_snapshot" text;
--> statement-breakpoint
UPDATE "sites"
SET
  "deleted_at" = COALESCE("updated_at", "created_at", now()),
  "name_snapshot" = COALESCE("name_snapshot", "name"),
  "is_default" = false
WHERE "status" = 'inactive' AND "deleted_at" IS NULL;
--> statement-breakpoint
-- If deactivating the old way cleared the only default, point new records at a living plant.
UPDATE "sites"
SET "is_default" = true
WHERE "id" = (
  SELECT "id" FROM "sites"
  WHERE "deleted_at" IS NULL AND "status" = 'active'
  ORDER BY "id"
  LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM "sites" WHERE "is_default" = true AND "deleted_at" IS NULL AND "status" = 'active'
);
--> statement-breakpoint
DROP INDEX IF EXISTS "sites_code_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "sites_code_idx" ON "sites" ("code") WHERE "deleted_at" IS NULL AND "status" = 'active';
--> statement-breakpoint
-- Names can be reused once a plant is deleted or inactive. Skip the index only
-- when two living plants already share a name, so this migration still applies.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "sites"
    WHERE "deleted_at" IS NULL AND "status" = 'active'
    GROUP BY lower("name")
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "sites_name_active_idx" ON "sites" (lower("name")) WHERE "deleted_at" IS NULL AND "status" = 'active';
  END IF;
END $$;
--> statement-breakpoint
UPDATE "roles"
SET "permissions" = "permissions" || '["plants.delete"]'::jsonb
WHERE "name" IN ('owner', 'admin')
  AND NOT ("permissions" ? 'plants.delete');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION accuqual_user_default_site_before() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sid int;
BEGIN
  IF NEW.current_site_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT id INTO sid FROM sites
  WHERE is_default = true AND deleted_at IS NULL AND status = 'active'
  ORDER BY id LIMIT 1;
  IF sid IS NOT NULL THEN
    NEW.current_site_id := sid;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION accuqual_user_default_site_after() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sid int;
BEGIN
  SELECT id INTO sid FROM sites
  WHERE is_default = true AND deleted_at IS NULL AND status = 'active'
  ORDER BY id LIMIT 1;
  IF sid IS NOT NULL THEN
    INSERT INTO user_sites (user_id, site_id)
    VALUES (NEW.id, sid)
    ON CONFLICT (user_id, site_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION accuqual_fill_site_id() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.site_id IS NULL THEN
    SELECT id INTO NEW.site_id
    FROM sites
    WHERE is_default = true AND deleted_at IS NULL AND status = 'active'
    ORDER BY id
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;
