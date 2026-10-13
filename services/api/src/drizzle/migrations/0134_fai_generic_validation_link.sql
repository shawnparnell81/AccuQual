-- 0134_fai_generic_validation_link.sql: one generic link from an FAI record to its validation report, for every form type.
-- The old linked_csa_fai_id / linked_fuel_pump_fai_id columns stay and stay readable (CSA and Fuel Pump keep using them),
-- so no existing record changes and nothing is backfilled. Additive only.
ALTER TABLE insp_records ADD COLUMN IF NOT EXISTS linked_validation_report_id INTEGER REFERENCES validation_reports(id) ON DELETE SET NULL;
ALTER TABLE insp_records ADD COLUMN IF NOT EXISTS linked_validation_form_type TEXT;
CREATE INDEX IF NOT EXISTS insp_records_linked_validation_report_idx ON insp_records (linked_validation_report_id);
