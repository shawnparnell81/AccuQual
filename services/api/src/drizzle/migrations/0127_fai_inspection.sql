-- 0127_fai_inspection.sql — FAI & Inspection module (Phase 1). Additive only: new tables.
-- Does not touch existing tables, forms, or the retired fai_* tables.

-- Inspection plans: parts the module knows about.
CREATE TABLE IF NOT EXISTS insp_plans (
  id SERIAL PRIMARY KEY,
  part_number TEXT NOT NULL,
  part_description TEXT,
  product_family TEXT,
  supplier_id INTEGER REFERENCES suppliers(id),
  supplier_factory TEXT,
  receiving_location TEXT,
  risk_class TEXT NOT NULL DEFAULT 'Major', -- Critical | Major | Minor
  revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'Draft', -- Draft | Active | Obsolete
  repeat_interval_months INTEGER NOT NULL DEFAULT 6,
  major_aql TEXT NOT NULL DEFAULT '1.0',
  minor_aql TEXT NOT NULL DEFAULT '2.5',
  notes TEXT,
  site_id INTEGER REFERENCES sites(id),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS insp_plans_part_number_idx ON insp_plans (part_number);
CREATE INDEX IF NOT EXISTS insp_plans_site_id_idx ON insp_plans (site_id);

-- Characteristics belonging to a plan revision. Immutable once a record uses them.
CREATE TABLE IF NOT EXISTS insp_plan_characteristics (
  id SERIAL PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES insp_plans(id),
  revision INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  char_type TEXT NOT NULL DEFAULT 'Major', -- Critical | Major | Minor
  limit_type TEXT NOT NULL DEFAULT 'plus_minus', -- plus_minus | percent | min_max | attribute
  nominal TEXT,
  tolerance_plus TEXT,
  tolerance_minus TEXT,
  percent TEXT,
  spec_min TEXT,
  spec_max TEXT,
  unit TEXT,
  method TEXT
);
CREATE INDEX IF NOT EXISTS insp_plan_characteristics_plan_idx ON insp_plan_characteristics (plan_id, revision);

-- Approved sources: one row per Part + Supplier + Factory + Receiving location.
CREATE TABLE IF NOT EXISTS insp_approved_sources (
  id SERIAL PRIMARY KEY,
  part_number TEXT NOT NULL,
  supplier_id INTEGER REFERENCES suppliers(id),
  supplier_factory TEXT,
  receiving_location TEXT,
  status TEXT NOT NULL DEFAULT 'not_approved', -- not_approved | fai_required | approved | suspended
  last_fai_date TEXT,
  last_result TEXT,
  next_due_date TEXT,
  last_fai_id INTEGER,
  site_id INTEGER REFERENCES sites(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CONSTRAINT insp_approved_sources_unique UNIQUE (part_number, supplier_id, supplier_factory, receiving_location)
);
CREATE INDEX IF NOT EXISTS insp_approved_sources_site_idx ON insp_approved_sources (site_id);
CREATE INDEX IF NOT EXISTS insp_approved_sources_due_idx ON insp_approved_sources (next_due_date);

-- FAI / inspection records. FAI number is typed by the user and must be unique.
CREATE TABLE IF NOT EXISTS insp_records (
  id SERIAL PRIMARY KEY,
  fai_number TEXT NOT NULL,
  plan_id INTEGER REFERENCES insp_plans(id),
  plan_revision INTEGER,
  part_number TEXT NOT NULL,
  supplier_id INTEGER REFERENCES suppliers(id),
  supplier_factory TEXT,
  receiving_location TEXT,
  trigger_reason TEXT, -- New part | New supplier | Supplier factory change | Receiving location change | 6-month repeat | Annual random pull | Engineering change | Other
  po_reference TEXT,
  lot_size INTEGER,
  sample_size INTEGER,
  inspector TEXT,
  date_pulled TEXT,
  date_lab_received TEXT,
  date_inspected TEXT,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | in_inspection | awaiting_signoff | passed | failed | cancelled
  overall_result TEXT,
  comments TEXT,
  inspection_level TEXT NOT NULL DEFAULT 'II', -- I | II | III | S-1 | S-2 | S-3 | S-4
  severity TEXT NOT NULL DEFAULT 'Normal', -- Normal | Tightened | Reduced
  major_aql TEXT,
  minor_aql TEXT,
  code_letter TEXT,
  aql_sample_size INTEGER,
  ac_major INTEGER,
  re_major INTEGER,
  ac_minor INTEGER,
  re_minor INTEGER,
  linked_csa_fai_id INTEGER,
  linked_fuel_pump_fai_id INTEGER,
  ncr_id INTEGER REFERENCES ncr(id),
  site_id INTEGER REFERENCES sites(id),
  signed_by INTEGER REFERENCES users(id),
  signed_at TIMESTAMPTZ,
  signature TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  CONSTRAINT insp_records_fai_number_unique UNIQUE (fai_number)
);
CREATE INDEX IF NOT EXISTS insp_records_status_idx ON insp_records (status);
CREATE INDEX IF NOT EXISTS insp_records_site_idx ON insp_records (site_id);
CREATE INDEX IF NOT EXISTS insp_records_part_idx ON insp_records (part_number);

-- Result lines. Calculated limits are SAVED here so history never changes.
CREATE TABLE IF NOT EXISTS insp_result_lines (
  id SERIAL PRIMARY KEY,
  record_id INTEGER NOT NULL REFERENCES insp_records(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  characteristic_name TEXT NOT NULL,
  char_type TEXT NOT NULL DEFAULT 'Major', -- Critical | Major | Minor
  limit_type TEXT NOT NULL DEFAULT 'plus_minus',
  nominal TEXT,
  tolerance_plus TEXT,
  tolerance_minus TEXT,
  percent TEXT,
  spec_min TEXT,
  spec_max TEXT,
  unit TEXT,
  method TEXT,
  limit_low TEXT,
  limit_high TEXT,
  measured_value TEXT,
  attribute_result TEXT,
  result TEXT, -- pass | fail
  defects INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS insp_result_lines_record_idx ON insp_result_lines (record_id);
