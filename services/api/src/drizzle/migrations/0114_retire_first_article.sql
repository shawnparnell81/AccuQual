-- Retire First Article module rows. Tables stay.
-- Blank form templates, including First Article Inspection Report (frm-fai-001), stay.
-- Shortcuts that start that blank (/blank-forms/start/...) are not removed.
-- Validation blanks (CSA Validation, Fuel Pump Validation, and the rest) are not touched.

DO $$
DECLARE
  ids integer[];
  removed integer;
BEGIN
  WITH RECURSIVE doomed AS (
    SELECT id
    FROM document_folders
    WHERE linked_path LIKE '/fai%'
       OR linked_path LIKE '/qms-forms/first_article_inspection%'
       OR linked_path IN (
         SELECT '/iso-forms/record/' || id::text
         FROM iso_quality_forms
         WHERE form_type = 'first_article'
       )
       OR linked_path IN (
         SELECT '/qms-forms/first_article_inspection/' || id::text
         FROM qms_forms
         WHERE form_type = 'first_article_inspection'
       )
       OR id IN (
         SELECT folder_node_id
         FROM form_filings
         WHERE form_key IN ('frm-fai-001', 'first_article_inspection')
           AND folder_node_id IS NOT NULL
       )
    UNION
    SELECT child.id
    FROM document_folders AS child
    INNER JOIN doomed ON child.parent_id = doomed.id
  )
  SELECT COALESCE(array_agg(id), ARRAY[]::integer[]) INTO ids FROM doomed;

  UPDATE built_forms SET folder_id = NULL WHERE folder_id = ANY(ids);
  UPDATE built_form_fills SET folder_id = NULL WHERE folder_id = ANY(ids);
  UPDATE pdf_exports SET folder_id = NULL WHERE folder_id = ANY(ids);

  DELETE FROM form_filings
  WHERE form_key IN ('frm-fai-001', 'first_article_inspection')
     OR folder_node_id = ANY(ids);

  LOOP
    DELETE FROM document_folders AS folder
    WHERE folder.id = ANY(ids)
      AND NOT EXISTS (SELECT 1 FROM document_folders AS child WHERE child.parent_id = folder.id);
    GET DIAGNOSTICS removed = ROW_COUNT;
    EXIT WHEN removed = 0;
  END LOOP;

  DELETE FROM qms_form_rows
  WHERE form_id IN (SELECT id FROM qms_forms WHERE form_type = 'first_article_inspection');
  DELETE FROM qms_forms WHERE form_type = 'first_article_inspection';
  DELETE FROM iso_quality_forms WHERE form_type = 'first_article';

  DELETE FROM fai_result_lines;
  DELETE FROM fai_annual_pulls;
  DELETE FROM fai_source_approvals;
  DELETE FROM fai_records;
  DELETE FROM fai_plan_characteristics;
  DELETE FROM fai_plan_revisions;
  DELETE FROM fai_inspection_plans;
  DELETE FROM fai_number_counters;

  DELETE FROM csa_fai_records;
  DELETE FROM fuel_pump_fai_records;
  DELETE FROM csa_fai_counters;
  DELETE FROM fuel_pump_fai_counters;

  UPDATE workflow_runs
  SET status = 'failed',
      finished_at = COALESCE(finished_at, now()),
      error = 'First Article was removed. This run is closed.'
  WHERE status IN ('running', 'waiting_approval')
    AND workflow_id IN (
      SELECT id FROM workflow_definitions
      WHERE module IN ('fai', 'csa_fai', 'fuel_pump_fai')
         OR name ILIKE '%first article%'
         OR name ILIKE '%csa fai%'
         OR name ILIKE '%fuel pump module fai%'
    );

  UPDATE workflow_definitions
  SET is_active = 'false',
      updated_at = now()
  WHERE module IN ('fai', 'csa_fai', 'fuel_pump_fai')
     OR name ILIKE '%first article%'
     OR name ILIKE '%csa fai%'
     OR name ILIKE '%fuel pump module fai%';

  DELETE FROM notification_log
  WHERE related_entity_type IN ('fai', 'csa_fai', 'fuel_pump_fai', 'CsaFai', 'FuelPumpFai', 'Fai');

  DELETE FROM attachments
  WHERE entity_type IN ('fai', 'csa_fai', 'fuel_pump_fai', 'first_article', 'CsaFai', 'FuelPumpFai');

  DELETE FROM pdf_exports
  WHERE source_module IN ('fai', 'csa_fai', 'fuel_pump_fai', 'first_article')
     OR entity_type IN ('fai', 'csa_fai', 'fuel_pump_fai', 'first_article', 'CsaFai', 'FuelPumpFai');
END $$;
