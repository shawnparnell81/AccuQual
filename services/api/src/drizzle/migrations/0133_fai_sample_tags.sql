-- 0133_fai_sample_tags.sql: FAI & AQL sample tags (barcode labels).
-- A sample is the part number + lot/PO + sample number on its FAI record. This table only remembers the code each sample's tag
-- carries (<FAI number>-S<n>, for example FAI-0012-S03) so a scan resolves back to the record and the sample, and how often it was printed.
-- It is not an inventory record: no stock, quantity on hand or transfer. Additive only; it does not touch insp_records or any form.
CREATE TABLE IF NOT EXISTS insp_record_samples (
  id SERIAL PRIMARY KEY,
  record_id INTEGER NOT NULL REFERENCES insp_records(id) ON DELETE CASCADE,
  sample_number INTEGER NOT NULL,
  code TEXT NOT NULL,
  printed_count INTEGER NOT NULL DEFAULT 0,
  last_printed_at TIMESTAMPTZ,
  last_printed_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT insp_record_samples_number_ck CHECK (sample_number >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS insp_record_samples_record_number_uq ON insp_record_samples (record_id, sample_number);
CREATE UNIQUE INDEX IF NOT EXISTS insp_record_samples_code_uq ON insp_record_samples (lower(code));
