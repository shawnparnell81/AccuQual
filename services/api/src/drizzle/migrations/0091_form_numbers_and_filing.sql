-- Document number snapshot and in-app folder for the eight quality forms.
-- The live number stays on controlled_form_templates.form_id.
-- A filled copy keeps the number stored here. NCR and CAPA tables are unchanged.
CREATE TABLE IF NOT EXISTS "form_filings" (
  "id" serial PRIMARY KEY NOT NULL,
  "form_key" text NOT NULL,
  "record_id" integer NOT NULL,
  "form_number" text NOT NULL DEFAULT '',
  "folder_node_id" integer,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp,
  CONSTRAINT "form_filings_form_key_record_id_unique" UNIQUE("form_key", "record_id")
);

DO $$ BEGIN
  ALTER TABLE "form_filings" ADD CONSTRAINT "form_filings_folder_node_id_document_folders_id_fk" FOREIGN KEY ("folder_node_id") REFERENCES "public"."document_folders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Copies that already exist keep a blank number. Later edits to the master do not fill these in.
INSERT INTO "form_filings" ("form_key", "record_id", "form_number")
SELECT CASE "form_type"
  WHEN 'psw' THEN 'frm-psw-001'
  WHEN 'turtle_diagram' THEN 'frm-prc-001'
  WHEN 'quality_alert' THEN 'frm-qa-001'
  WHEN 'first_article' THEN 'frm-fai-001'
  WHEN 'customer_scorecard' THEN 'frm-cus-001'
  WHEN 'failure_effectiveness' THEN 'frm-fae-001'
END, "id", ''
FROM "iso_quality_forms"
WHERE "form_type" IN ('psw', 'turtle_diagram', 'quality_alert', 'first_article', 'customer_scorecard', 'failure_effectiveness')
ON CONFLICT ("form_key", "record_id") DO NOTHING;

INSERT INTO "form_filings" ("form_key", "record_id", "form_number")
SELECT 'frm-msa-001', "entity_id", ''
FROM (SELECT DISTINCT "entity_id" FROM "form_data" WHERE "form_type" = 'gage_rr' AND "entity_id" IS NOT NULL) gage
ON CONFLICT ("form_key", "record_id") DO NOTHING;

INSERT INTO "form_filings" ("form_key", "record_id", "form_number")
SELECT 'frm-par-001', "entity_id", ''
FROM (SELECT DISTINCT "entity_id" FROM "form_data" WHERE "form_type" = 'pareto_chart' AND "entity_id" IS NOT NULL) pareto
ON CONFLICT ("form_key", "record_id") DO NOTHING;
