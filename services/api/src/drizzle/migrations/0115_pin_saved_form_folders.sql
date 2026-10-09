-- Pin existing title-matched records into form_filings.
-- A later rename stays in the folder it was filed under.
-- Rows that are already pinned are left as they are.

INSERT INTO form_filings (form_key, record_id, form_number)
SELECT 'supplier-ncr', id, ''
FROM ncr
WHERE title = 'Supplier NCR' AND is_deleted = false
ON CONFLICT (form_key, record_id) DO NOTHING;

INSERT INTO form_filings (form_key, record_id, form_number)
SELECT 'complaint', id, ''
FROM ncr
WHERE title = 'Customer Complaint Record' AND is_deleted = false
ON CONFLICT (form_key, record_id) DO NOTHING;

INSERT INTO form_filings (form_key, record_id, form_number)
SELECT 'ncr', id, ''
FROM ncr
WHERE is_deleted = false
  AND title IS DISTINCT FROM 'Supplier NCR'
  AND title IS DISTINCT FROM 'Customer Complaint Record'
ON CONFLICT (form_key, record_id) DO NOTHING;

INSERT INTO form_filings (form_key, record_id, form_number)
SELECT 'audit-plan', id, ''
FROM audits
WHERE name = 'Internal Audit Plan'
ON CONFLICT (form_key, record_id) DO NOTHING;

INSERT INTO form_filings (form_key, record_id, form_number)
SELECT 'audit-report', id, ''
FROM audits
WHERE name = 'Internal Audit Report'
ON CONFLICT (form_key, record_id) DO NOTHING;

INSERT INTO form_filings (form_key, record_id, form_number)
SELECT 'cal-register', id, ''
FROM equipment
WHERE name = 'Calibration Equipment Register'
ON CONFLICT (form_key, record_id) DO NOTHING;

INSERT INTO form_filings (form_key, record_id, form_number)
SELECT 'cal-record', id, ''
FROM equipment
WHERE name = 'Calibration Record'
ON CONFLICT (form_key, record_id) DO NOTHING;

INSERT INTO form_filings (form_key, record_id, form_number)
SELECT 'ecr', id, ''
FROM change_requests
WHERE title = 'Engineering Change Request'
ON CONFLICT (form_key, record_id) DO NOTHING;

INSERT INTO form_filings (form_key, record_id, form_number)
SELECT 'eco', id, ''
FROM change_requests
WHERE title = 'Engineering Change Order'
ON CONFLICT (form_key, record_id) DO NOTHING;

INSERT INTO form_filings (form_key, record_id, form_number)
SELECT 'risk', id, ''
FROM risk_assessments
WHERE title = 'Risk & Opportunity Assessment'
ON CONFLICT (form_key, record_id) DO NOTHING;

INSERT INTO form_filings (form_key, record_id, form_number)
SELECT 'training-record', id, ''
FROM training_courses
WHERE title = 'Training & Competency Record'
ON CONFLICT (form_key, record_id) DO NOTHING;
