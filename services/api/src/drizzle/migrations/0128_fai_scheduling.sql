-- 0128_fai_scheduling.sql — FAI & Inspection module (Phase 2: scheduling). Additive only: new tables.
-- Does not touch insp_plans/insp_approved_sources/insp_records/insp_result_lines, the retired fai_* tables, or any form.

-- Random-pull rules: one row, editable with fai.schedule.manage.
CREATE TABLE IF NOT EXISTS fai_random_pull_rules (
  id SERIAL PRIMARY KEY,
  pick_mode TEXT NOT NULL DEFAULT 'percent', -- percent | count
  pick_percent INTEGER,
  pick_count INTEGER,
  product_family TEXT,
  risk_class TEXT, -- Critical | Major | Minor
  site_id INTEGER REFERENCES sites(id),
  exclude_months INTEGER NOT NULL DEFAULT 6,
  updated_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMPTZ
);

-- One generated-and-reviewed pick list per "Generate pick list" + approve.
CREATE TABLE IF NOT EXISTS fai_random_pull_batches (
  id SERIAL PRIMARY KEY,
  year INTEGER NOT NULL,
  rules_snapshot JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_approval', -- pending_approval | approved
  generated_by INTEGER REFERENCES users(id),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by INTEGER REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  approval_signature TEXT
);
CREATE INDEX IF NOT EXISTS fai_random_pull_batches_year_idx ON fai_random_pull_batches (year);

-- Sources picked within a batch. Status is derived (pending / linked / completed), never stored here.
CREATE TABLE IF NOT EXISTS fai_random_pull_items (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES fai_random_pull_batches(id),
  source_id INTEGER NOT NULL REFERENCES insp_approved_sources(id),
  linked_record_id INTEGER REFERENCES insp_records(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fai_random_pull_items_batch_source_unique UNIQUE (batch_id, source_id)
);
CREATE INDEX IF NOT EXISTS fai_random_pull_items_batch_idx ON fai_random_pull_items (batch_id);
CREATE INDEX IF NOT EXISTS fai_random_pull_items_source_idx ON fai_random_pull_items (source_id);
