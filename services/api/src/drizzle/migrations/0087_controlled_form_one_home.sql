-- Each blank form template has one home: ISO Compliance > Validation.
-- The Forms Library lists these same rows. Filled-in validation reports
-- stay in validation_reports and are opened from Quality > Validation Reports.
-- This undoes the extra folder links from 0086. No filled record is deleted.

ALTER TABLE "controlled_form_templates" ADD COLUMN IF NOT EXISTS "folder_id" integer;

INSERT INTO "document_folders" ("name", "parent_id", "sort_order")
SELECT 'ISO Compliance', NULL, COALESCE((SELECT MAX("sort_order") + 1 FROM "document_folders" WHERE "parent_id" IS NULL), 0)
WHERE EXISTS (SELECT 1 FROM "document_folders" WHERE "parent_id" IS NULL AND "name" = 'Quality')
  AND NOT EXISTS (SELECT 1 FROM "document_folders" WHERE "parent_id" IS NULL AND "name" = 'ISO Compliance');

INSERT INTO "document_folders" ("name", "parent_id", "sort_order")
SELECT 'Validation', iso."id", COALESCE((SELECT MAX("sort_order") + 1 FROM "document_folders" WHERE "parent_id" = iso."id"), 0)
FROM "document_folders" iso
WHERE iso."parent_id" IS NULL AND iso."name" = 'ISO Compliance'
  AND NOT EXISTS (
    SELECT 1 FROM "document_folders" child WHERE child."parent_id" = iso."id" AND child."name" = 'Validation'
  );

INSERT INTO "controlled_form_templates" ("form_key", "doc_id", "title", "route")
SELECT 'frm-val-001', 'FRM-VAL-001', 'CSA Validation Report', '/folders/validation-reports'
WHERE NOT EXISTS (SELECT 1 FROM "controlled_form_templates" WHERE "form_key" = 'frm-val-001');

INSERT INTO "controlled_form_templates" ("form_key", "doc_id", "title", "route")
SELECT 'frm-val-007', 'FRM-VAL-007', 'Fuel Pump Validation', '/folders/validation-reports'
WHERE NOT EXISTS (SELECT 1 FROM "controlled_form_templates" WHERE "form_key" = 'frm-val-007');

UPDATE "controlled_form_templates" AS template
SET "folder_id" = topic."id"
FROM "document_folders" topic
JOIN "document_folders" iso ON iso."id" = topic."parent_id" AND iso."parent_id" IS NULL AND iso."name" = 'ISO Compliance'
WHERE topic."name" = 'Validation'
  AND template."form_key" IN ('frm-val-001', 'frm-val-007');

DROP TABLE IF EXISTS "controlled_form_links";

DELETE FROM "document_folders" AS child
WHERE child."name" = 'Controlled Forms'
  AND child."pdf_path" IS NULL
  AND child."document_id" IS NULL
  AND child."linked_path" IS NULL
  AND EXISTS (
    SELECT 1 FROM "document_folders" parent
    WHERE parent."id" = child."parent_id" AND parent."parent_id" IS NULL AND parent."name" = 'ISO Compliance'
  )
  AND NOT EXISTS (SELECT 1 FROM "document_folders" grandchild WHERE grandchild."parent_id" = child."id")
  AND NOT EXISTS (SELECT 1 FROM "controlled_form_templates" template WHERE template."folder_id" = child."id");

DELETE FROM "document_folders" AS child
WHERE child."name" = 'Validation Reports'
  AND child."pdf_path" IS NULL
  AND child."document_id" IS NULL
  AND child."linked_path" IS NULL
  AND EXISTS (
    SELECT 1 FROM "document_folders" parent
    WHERE parent."id" = child."parent_id" AND parent."parent_id" IS NULL AND parent."name" = 'Quality'
  )
  AND NOT EXISTS (SELECT 1 FROM "document_folders" grandchild WHERE grandchild."parent_id" = child."id")
  AND NOT EXISTS (SELECT 1 FROM "controlled_form_templates" template WHERE template."folder_id" = child."id");

DO $$ BEGIN
  ALTER TABLE "controlled_form_templates" ADD CONSTRAINT "controlled_form_templates_folder_id_document_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."document_folders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
