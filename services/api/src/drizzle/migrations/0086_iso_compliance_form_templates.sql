-- Blank form templates have one home under ISO Compliance Documents / 03_Blank_Forms_Templates.
-- Filled validation reports stay in validation_reports. Nothing filled in is deleted.
CREATE TABLE IF NOT EXISTS "controlled_form_templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "form_key" text NOT NULL,
  "form_id" text NOT NULL,
  "title" text NOT NULL,
  "subject_route" text NOT NULL,
  "folder_id" integer,
  "created_at" timestamp DEFAULT now(),
  CONSTRAINT "controlled_form_templates_form_key_unique" UNIQUE("form_key")
);

ALTER TABLE "controlled_form_templates" ADD COLUMN IF NOT EXISTS "form_id" text;
ALTER TABLE "controlled_form_templates" ADD COLUMN IF NOT EXISTS "subject_route" text;
ALTER TABLE "controlled_form_templates" ADD COLUMN IF NOT EXISTS "folder_id" integer;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'controlled_form_templates' AND column_name = 'doc_id'
  ) THEN
    EXECUTE 'UPDATE "controlled_form_templates" SET "form_id" = "doc_id" WHERE "form_id" IS NULL';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'controlled_form_templates' AND column_name = 'route'
  ) THEN
    EXECUTE 'UPDATE "controlled_form_templates" SET "subject_route" = "route" WHERE "subject_route" IS NULL';
    EXECUTE 'ALTER TABLE "controlled_form_templates" ALTER COLUMN "doc_id" DROP NOT NULL';
    EXECUTE 'ALTER TABLE "controlled_form_templates" ALTER COLUMN "route" DROP NOT NULL';
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE "controlled_form_templates" ADD CONSTRAINT "controlled_form_templates_folder_id_document_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."document_folders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

UPDATE "document_folders"
SET "name" = 'ISO Compliance Documents'
WHERE "parent_id" IS NULL AND "name" = 'ISO Compliance'
  AND NOT EXISTS (
    SELECT 1 FROM "document_folders" WHERE "parent_id" IS NULL AND "name" = 'ISO Compliance Documents'
  );

INSERT INTO "document_folders" ("name", "parent_id", "sort_order")
SELECT 'ISO Compliance Documents', NULL, COALESCE((SELECT MAX("sort_order") + 1 FROM "document_folders" WHERE "parent_id" IS NULL), 0)
WHERE EXISTS (SELECT 1 FROM "document_folders" WHERE "parent_id" IS NULL AND "name" = 'Quality')
  AND NOT EXISTS (SELECT 1 FROM "document_folders" WHERE "parent_id" IS NULL AND "name" = 'ISO Compliance Documents');

INSERT INTO "document_folders" ("name", "parent_id", "sort_order")
SELECT '03_Blank_Forms_Templates', iso."id", 0
FROM "document_folders" iso
WHERE iso."parent_id" IS NULL AND iso."name" = 'ISO Compliance Documents'
  AND NOT EXISTS (
    SELECT 1 FROM "document_folders" child WHERE child."parent_id" = iso."id" AND child."name" = '03_Blank_Forms_Templates'
  );

INSERT INTO "document_folders" ("name", "parent_id", "sort_order")
SELECT 'Validation', blanks."id", 0
FROM "document_folders" blanks
JOIN "document_folders" iso ON iso."id" = blanks."parent_id" AND iso."parent_id" IS NULL AND iso."name" = 'ISO Compliance Documents'
WHERE blanks."name" = '03_Blank_Forms_Templates'
  AND NOT EXISTS (
    SELECT 1 FROM "document_folders" child WHERE child."parent_id" = blanks."id" AND child."name" = 'Validation'
  );

INSERT INTO "document_folders" ("name", "parent_id", "sort_order")
SELECT 'Problem Solving', blanks."id", 1
FROM "document_folders" blanks
JOIN "document_folders" iso ON iso."id" = blanks."parent_id" AND iso."parent_id" IS NULL AND iso."name" = 'ISO Compliance Documents'
WHERE blanks."name" = '03_Blank_Forms_Templates'
  AND NOT EXISTS (
    SELECT 1 FROM "document_folders" child WHERE child."parent_id" = blanks."id" AND child."name" = 'Problem Solving'
  );

INSERT INTO "controlled_form_templates" ("form_key", "form_id", "title", "subject_route", "folder_id")
SELECT 'frm-val-001', 'FRM-VAL-001', 'CSA Validation Report', '/folders/validation-reports', topic."id"
FROM "document_folders" topic
JOIN "document_folders" blanks ON blanks."id" = topic."parent_id" AND blanks."name" = '03_Blank_Forms_Templates'
JOIN "document_folders" iso ON iso."id" = blanks."parent_id" AND iso."parent_id" IS NULL AND iso."name" = 'ISO Compliance Documents'
WHERE topic."name" = 'Validation'
  AND NOT EXISTS (SELECT 1 FROM "controlled_form_templates" WHERE "form_key" = 'frm-val-001');

INSERT INTO "controlled_form_templates" ("form_key", "form_id", "title", "subject_route", "folder_id")
SELECT 'frm-val-007', 'FRM-VAL-007', 'Fuel Pump Validation', '/folders/validation-reports', topic."id"
FROM "document_folders" topic
JOIN "document_folders" blanks ON blanks."id" = topic."parent_id" AND blanks."name" = '03_Blank_Forms_Templates'
JOIN "document_folders" iso ON iso."id" = blanks."parent_id" AND iso."parent_id" IS NULL AND iso."name" = 'ISO Compliance Documents'
WHERE topic."name" = 'Validation'
  AND NOT EXISTS (SELECT 1 FROM "controlled_form_templates" WHERE "form_key" = 'frm-val-007');

INSERT INTO "controlled_form_templates" ("form_key", "form_id", "title", "subject_route", "folder_id")
SELECT '8d', '8D', '8D Problem Solving', '/8d', topic."id"
FROM "document_folders" topic
JOIN "document_folders" blanks ON blanks."id" = topic."parent_id" AND blanks."name" = '03_Blank_Forms_Templates'
JOIN "document_folders" iso ON iso."id" = blanks."parent_id" AND iso."parent_id" IS NULL AND iso."name" = 'ISO Compliance Documents'
WHERE topic."name" = 'Problem Solving'
  AND NOT EXISTS (SELECT 1 FROM "controlled_form_templates" WHERE "form_key" = '8d');
