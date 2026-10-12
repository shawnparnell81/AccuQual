-- 0129_fai_notifications.sql — FAI & Inspection module (Phase 3: email distribution lists). Additive only.
-- Does not touch insp_plans/insp_approved_sources/insp_records/insp_result_lines, fai_random_pull_*, the retired fai_* tables, or any form.

CREATE TABLE IF NOT EXISTS fai_distribution_lists (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  members JSONB NOT NULL DEFAULT '[]',
  match_site_id INTEGER REFERENCES sites(id),
  match_product_family TEXT,
  match_trigger_reason TEXT,
  match_event_types JSONB NOT NULL DEFAULT '[]',
  monday_summary BOOLEAN NOT NULL DEFAULT false,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS fai_distribution_lists_site_idx ON fai_distribution_lists (match_site_id);
