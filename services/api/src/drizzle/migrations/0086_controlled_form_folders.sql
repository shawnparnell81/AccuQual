-- A form template can be listed in more than one folder. Nothing here is deleted.
CREATE TABLE IF NOT EXISTS "controlled_form_templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "form_key" text NOT NULL,
  "doc_id" text NOT NULL,
  "title" text NOT NULL,
  "route" text NOT NULL,
  "created_at" timestamp DEFAULT now(),
  CONSTRAINT "controlled_form_templates_form_key_unique" UNIQUE("form_key")
);

CREATE TABLE IF NOT EXISTS "controlled_form_links" (
  "id" serial PRIMARY KEY NOT NULL,
  "template_id" integer NOT NULL,
  "folder_id" integer,
  "category_key" text
);

DO $$ BEGIN
  ALTER TABLE "controlled_form_links" ADD CONSTRAINT "controlled_form_links_template_id_controlled_form_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."controlled_form_templates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "controlled_form_links" ADD CONSTRAINT "controlled_form_links_folder_id_document_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."document_folders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "controlled_form_links_folder_uidx" ON "controlled_form_links" ("template_id", "folder_id") WHERE "folder_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "controlled_form_links_category_uidx" ON "controlled_form_links" ("template_id", "category_key") WHERE "category_key" IS NOT NULL;

-- ISO Compliance is its own folder in the document library. Skip when the
-- company tree has not been seeded yet; the folder list self-heals it then.
INSERT INTO "document_folders" ("name", "parent_id", "sort_order")
SELECT 'ISO Compliance', NULL, COALESCE((SELECT MAX("sort_order") + 1 FROM "document_folders" WHERE "parent_id" IS NULL), 0)
WHERE EXISTS (SELECT 1 FROM "document_folders" WHERE "parent_id" IS NULL AND "name" = 'Quality')
  AND NOT EXISTS (SELECT 1 FROM "document_folders" WHERE "parent_id" IS NULL AND "name" = 'ISO Compliance');

INSERT INTO "document_folders" ("name", "parent_id", "sort_order")
SELECT 'Controlled Forms', iso."id", 0
FROM "document_folders" iso
WHERE iso."parent_id" IS NULL AND iso."name" = 'ISO Compliance'
  AND NOT EXISTS (
    SELECT 1 FROM "document_folders" child WHERE child."parent_id" = iso."id" AND child."name" = 'Controlled Forms'
  );

INSERT INTO "document_folders" ("name", "parent_id", "sort_order")
SELECT 'Validation Reports', quality."id", COALESCE((SELECT MAX("sort_order") + 1 FROM "document_folders" WHERE "parent_id" = quality."id"), 0)
FROM "document_folders" quality
WHERE quality."parent_id" IS NULL AND quality."name" = 'Quality'
  AND NOT EXISTS (
    SELECT 1 FROM "document_folders" child WHERE child."parent_id" = quality."id" AND child."name" = 'Validation Reports'
  );

INSERT INTO "controlled_form_templates" ("form_key", "doc_id", "title", "route")
SELECT 'frm-val-001', 'FRM-VAL-001', 'CSA Validation Report', '/folders/validation-reports'
WHERE NOT EXISTS (SELECT 1 FROM "controlled_form_templates" WHERE "form_key" = 'frm-val-001');

INSERT INTO "controlled_form_templates" ("form_key", "doc_id", "title", "route")
SELECT 'frm-val-007', 'FRM-VAL-007', 'Fuel Pump Validation', '/folders/validation-reports'
WHERE NOT EXISTS (SELECT 1 FROM "controlled_form_templates" WHERE "form_key" = 'frm-val-007');

INSERT INTO "controlled_form_links" ("template_id", "folder_id")
SELECT template."id", folder."id"
FROM "controlled_form_templates" template
JOIN "document_folders" folder ON folder."name" = 'Controlled Forms'
JOIN "document_folders" parent ON parent."id" = folder."parent_id" AND parent."name" = 'ISO Compliance' AND parent."parent_id" IS NULL
WHERE template."form_key" IN ('frm-val-001', 'frm-val-007')
  AND NOT EXISTS (
    SELECT 1 FROM "controlled_form_links" link
    WHERE link."template_id" = template."id" AND link."folder_id" = folder."id"
  );

INSERT INTO "controlled_form_links" ("template_id", "folder_id")
SELECT template."id", folder."id"
FROM "controlled_form_templates" template
JOIN "document_folders" folder ON folder."name" = 'Validation Reports'
JOIN "document_folders" parent ON parent."id" = folder."parent_id" AND parent."name" = 'Quality' AND parent."parent_id" IS NULL
WHERE template."form_key" IN ('frm-val-001', 'frm-val-007')
  AND NOT EXISTS (
    SELECT 1 FROM "controlled_form_links" link
    WHERE link."template_id" = template."id" AND link."folder_id" = folder."id"
  );

INSERT INTO "controlled_form_links" ("template_id", "category_key")
SELECT template."id", 'validation-reports'
FROM "controlled_form_templates" template
WHERE template."form_key" IN ('frm-val-001', 'frm-val-007')
  AND NOT EXISTS (
    SELECT 1 FROM "controlled_form_links" link
    WHERE link."template_id" = template."id" AND link."category_key" = 'validation-reports'
  );
