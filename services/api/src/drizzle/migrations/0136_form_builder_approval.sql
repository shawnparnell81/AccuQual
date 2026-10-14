-- 0136_form_builder_approval.sql: a built form's new revision waits for approval before fillers see it.
-- Every row that already exists was live when it was saved, so it counts as approved.
-- Additive only.
ALTER TABLE built_form_revisions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE built_form_revisions ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id);
ALTER TABLE built_form_revisions ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;
ALTER TABLE built_form_revisions ADD COLUMN IF NOT EXISTS decision_note TEXT;
-- One pending revision per form, enforced here as well as in the service so two submits at once cannot both win.
CREATE UNIQUE INDEX IF NOT EXISTS built_form_revisions_one_pending ON built_form_revisions (form_id) WHERE status = 'pending';
