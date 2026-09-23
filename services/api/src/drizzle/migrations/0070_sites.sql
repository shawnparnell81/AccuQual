-- One organization, many plants. Existing tenants get a "Main plant".
-- Existing issues, fixes, and audits attach to that plant so lists stay
-- populated. Controlled documents are not in this migration: they stay
-- organization-wide (no site_id).

CREATE TABLE IF NOT EXISTS "sites" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "code" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "sites_tenant_code_idx" ON "sites" ("tenant_id", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "sites_one_default_per_tenant" ON "sites" ("tenant_id") WHERE "is_default";

CREATE TABLE IF NOT EXISTS "user_sites" (
  "id" serial PRIMARY KEY NOT NULL,
  "tenant_id" integer NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "site_id" integer NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_sites_user_site_idx" ON "user_sites" ("user_id", "site_id");

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "current_site_id" integer;

ALTER TABLE "ncr" ADD COLUMN IF NOT EXISTS "site_id" integer;
ALTER TABLE "capa" ADD COLUMN IF NOT EXISTS "site_id" integer;
ALTER TABLE "audits" ADD COLUMN IF NOT EXISTS "site_id" integer;

INSERT INTO "sites" ("tenant_id", "name", "code", "status", "is_default")
SELECT t.id, 'Main plant', 'main', 'active', true
FROM "tenants" t
WHERE NOT EXISTS (SELECT 1 FROM "sites" s WHERE s.tenant_id = t.id AND s.is_default = true);

UPDATE "ncr" n
SET "site_id" = s.id
FROM "sites" s
WHERE s.tenant_id = n.tenant_id AND s.is_default = true AND n.site_id IS NULL;

UPDATE "capa" c
SET "site_id" = s.id
FROM "sites" s
WHERE s.tenant_id = c.tenant_id AND s.is_default = true AND c.site_id IS NULL;

UPDATE "audits" a
SET "site_id" = s.id
FROM "sites" s
WHERE s.tenant_id = a.tenant_id AND s.is_default = true AND a.site_id IS NULL;

INSERT INTO "user_sites" ("tenant_id", "user_id", "site_id")
SELECT u.tenant_id, u.id, s.id
FROM "users" u
JOIN "sites" s ON s.tenant_id = u.tenant_id AND s.is_default = true
WHERE u.tenant_id IS NOT NULL
ON CONFLICT ("user_id", "site_id") DO NOTHING;

UPDATE "users" u
SET "current_site_id" = s.id
FROM "sites" s
WHERE u.tenant_id IS NOT NULL
  AND s.tenant_id = u.tenant_id
  AND s.is_default = true
  AND u.current_site_id IS NULL;

ALTER TABLE "ncr" ALTER COLUMN "site_id" SET NOT NULL;
ALTER TABLE "capa" ALTER COLUMN "site_id" SET NOT NULL;
ALTER TABLE "audits" ALTER COLUMN "site_id" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ncr_site_id_fk') THEN
    ALTER TABLE "ncr" ADD CONSTRAINT "ncr_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'capa_site_id_fk') THEN
    ALTER TABLE "capa" ADD CONSTRAINT "capa_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audits_site_id_fk') THEN
    ALTER TABLE "audits" ADD CONSTRAINT "audits_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_current_site_id_fk') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_current_site_id_fk" FOREIGN KEY ("current_site_id") REFERENCES "sites"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- New tenants get a main plant. New users are assigned to it. Inserts that
-- omit site_id (receiving automation, workflow actions, older callers) land
-- on that plant instead of failing the NOT NULL check.
CREATE OR REPLACE FUNCTION accuqual_tenant_default_site() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO sites (tenant_id, name, code, status, is_default)
  VALUES (NEW.id, 'Main plant', 'main', 'active', true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_default_site ON tenants;
CREATE TRIGGER tenants_default_site
AFTER INSERT ON tenants
FOR EACH ROW EXECUTE FUNCTION accuqual_tenant_default_site();

CREATE OR REPLACE FUNCTION accuqual_user_default_site_before() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sid int;
BEGIN
  IF NEW.tenant_id IS NULL OR NEW.current_site_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT id INTO sid FROM sites WHERE tenant_id = NEW.tenant_id AND is_default = true ORDER BY id LIMIT 1;
  IF sid IS NOT NULL THEN
    NEW.current_site_id := sid;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_default_site_before ON users;
CREATE TRIGGER users_default_site_before
BEFORE INSERT ON users
FOR EACH ROW EXECUTE FUNCTION accuqual_user_default_site_before();

CREATE OR REPLACE FUNCTION accuqual_user_default_site_after() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sid int;
BEGIN
  IF NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT id INTO sid FROM sites WHERE tenant_id = NEW.tenant_id AND is_default = true ORDER BY id LIMIT 1;
  IF sid IS NOT NULL THEN
    INSERT INTO user_sites (tenant_id, user_id, site_id)
    VALUES (NEW.tenant_id, NEW.id, sid)
    ON CONFLICT (user_id, site_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_default_site_after ON users;
CREATE TRIGGER users_default_site_after
AFTER INSERT ON users
FOR EACH ROW EXECUTE FUNCTION accuqual_user_default_site_after();

CREATE OR REPLACE FUNCTION accuqual_fill_site_id() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.site_id IS NULL THEN
    SELECT id INTO NEW.site_id
    FROM sites
    WHERE tenant_id = NEW.tenant_id AND is_default = true
    ORDER BY id
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ncr_fill_site_id ON ncr;
CREATE TRIGGER ncr_fill_site_id BEFORE INSERT ON ncr FOR EACH ROW EXECUTE FUNCTION accuqual_fill_site_id();
DROP TRIGGER IF EXISTS capa_fill_site_id ON capa;
CREATE TRIGGER capa_fill_site_id BEFORE INSERT ON capa FOR EACH ROW EXECUTE FUNCTION accuqual_fill_site_id();
DROP TRIGGER IF EXISTS audits_fill_site_id ON audits;
CREATE TRIGGER audits_fill_site_id BEFORE INSERT ON audits FOR EACH ROW EXECUTE FUNCTION accuqual_fill_site_id();
