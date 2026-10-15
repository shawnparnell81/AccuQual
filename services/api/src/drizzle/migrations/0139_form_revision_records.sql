-- 0139_form_revision_records.sql: PIN-signed approval of form revisions, and a revision history for the built-in forms.
-- Additive only. Existing rows and filled copies are not changed.
ALTER TABLE built_form_revisions ADD COLUMN IF NOT EXISTS approval_signature TEXT;
CREATE TABLE IF NOT EXISTS form_revision_records (
  id SERIAL PRIMARY KEY,
  form_key TEXT NOT NULL,
  revision TEXT NOT NULL,
  previous_revision TEXT,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  approved_by INTEGER REFERENCES users(id),
  approved_at TIMESTAMP,
  decision_note TEXT,
  approval_signature TEXT
);
CREATE INDEX IF NOT EXISTS form_revision_records_form_key ON form_revision_records (form_key, created_at);
-- One pending revision per form, so two submits at once cannot both win.
CREATE UNIQUE INDEX IF NOT EXISTS form_revision_records_one_pending ON form_revision_records (form_key) WHERE status = 'pending';
