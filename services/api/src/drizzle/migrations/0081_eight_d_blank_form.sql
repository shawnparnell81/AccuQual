-- Required. Copies the older 8D writeup into the Blank 8D boxes when those
-- boxes are still empty. The older keys are left on the row.
UPDATE eight_d
SET data = data || jsonb_strip_nulls(jsonb_build_object(
  'problemStatement', CASE
    WHEN coalesce(data->>'problemStatement', '') = '' AND jsonb_typeof(data->'d2_problem') = 'string' AND length(btrim(data->>'d2_problem')) > 0
    THEN to_jsonb(data->>'d2_problem') ELSE NULL END,
  'ica', CASE
    WHEN coalesce(data->>'ica', '') = '' AND jsonb_typeof(data->'d3_containment') = 'string' AND length(btrim(data->>'d3_containment')) > 0
    THEN to_jsonb(data->>'d3_containment') ELSE NULL END,
  'rootCauses', CASE
    WHEN coalesce(data->>'rootCauses', '') = '' AND jsonb_typeof(data->'d4_rootCause') = 'string' AND length(btrim(data->>'d4_rootCause')) > 0
    THEN to_jsonb(data->>'d4_rootCause') ELSE NULL END,
  'pca', CASE
    WHEN coalesce(data->>'pca', '') = '' AND jsonb_typeof(data->'d5_correctiveAction') = 'string' AND length(btrim(data->>'d5_correctiveAction')) > 0
    THEN to_jsonb(data->>'d5_correctiveAction') ELSE NULL END,
  'implementation', CASE
    WHEN coalesce(data->>'implementation', '') = '' AND jsonb_typeof(data->'d6_implementation') = 'string' AND length(btrim(data->>'d6_implementation')) > 0
    THEN to_jsonb(data->>'d6_implementation') ELSE NULL END,
  'prevention', CASE
    WHEN coalesce(data->>'prevention', '') = '' AND jsonb_typeof(data->'d7_prevention') = 'string' AND length(btrim(data->>'d7_prevention')) > 0
    THEN to_jsonb(data->>'d7_prevention') ELSE NULL END,
  'recognition', CASE
    WHEN coalesce(data->>'recognition', '') = '' AND jsonb_typeof(data->'d8_closure') = 'string' AND length(btrim(data->>'d8_closure')) > 0
    THEN to_jsonb(data->>'d8_closure') ELSE NULL END
))
WHERE data IS NOT NULL;
