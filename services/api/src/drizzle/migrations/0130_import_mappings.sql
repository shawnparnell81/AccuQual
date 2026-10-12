CREATE TABLE IF NOT EXISTS import_mappings (
  id SERIAL PRIMARY KEY,
  target_ref TEXT NOT NULL,
  file_kind TEXT NOT NULL,            -- docx | xlsx | csv
  name TEXT NOT NULL,
  entries JSONB NOT NULL DEFAULT '{}',
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS import_mappings_target_kind_name_idx ON import_mappings (target_ref, file_kind, lower(name));
