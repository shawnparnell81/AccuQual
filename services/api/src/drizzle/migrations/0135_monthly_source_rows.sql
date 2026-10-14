-- 0135_monthly_source_rows.sql: rows from DMA's monthly source spreadsheets (NCR log, labor claim tracker and export,
-- FAI trackers, tech-call log, product alerts), stored per calendar month so any month's Monthly Quality Report is
-- built from its own rows. One row per (source, row key): a re-upload updates rows in place, never duplicates.
-- Additive only.
CREATE TABLE IF NOT EXISTS monthly_source_uploads (
  id SERIAL PRIMARY KEY,
  file_name TEXT NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS monthly_source_rows (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  row_key TEXT NOT NULL,
  month TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  upload_id INTEGER REFERENCES monthly_source_uploads(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS monthly_source_rows_source_key_uq ON monthly_source_rows (source, row_key);
CREATE INDEX IF NOT EXISTS monthly_source_rows_month_idx ON monthly_source_rows (month, source);
-- A verified month keeps only these small totals (what later months' trend tables and charts need). Its raw rows
-- are deleted when the month is verified. Uploaded workbooks are never stored: they are parsed in memory.
CREATE TABLE IF NOT EXISTS monthly_source_months (
  month TEXT PRIMARY KEY,
  figures JSONB NOT NULL DEFAULT '{}'::jsonb,
  verified_by INTEGER REFERENCES users(id),
  verified_at TIMESTAMP NOT NULL DEFAULT NOW()
);
