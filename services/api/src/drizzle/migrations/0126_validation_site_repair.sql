-- One-off, idempotent repair. A validation report whose plant name and site_id
-- disagree takes site_id from the living plant that matches the name.
-- The name is data.siteName, then data.plant, then the latest audit siteName.
-- Duplicate living names use the lowest id. A second run changes nothing.

CREATE OR REPLACE FUNCTION repair_validation_site_ids() RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  rec record;
  repaired integer := 0;
BEGIN
  FOR rec IN
    WITH wanted AS (
      SELECT vr.id,
             vr.site_id,
             NULLIF(btrim(COALESCE(
               NULLIF(vr.data->>'siteName', ''),
               NULLIF(vr.data->>'plant', ''),
               (
                 SELECT at.changes->>'siteName'
                 FROM audit_trail at
                 WHERE at.entity_type = 'Validation Report'
                   AND at.entity_id = vr.id
                   AND COALESCE(at.changes->>'siteName', '') <> ''
                 ORDER BY at.id DESC
                 LIMIT 1
               )
             )), '') AS wanted_name
      FROM validation_reports vr
    )
    SELECT w.id,
           w.site_id AS old_site_id,
           w.wanted_name,
           s.id AS new_site_id,
           COALESCE(NULLIF(btrim(s.name_snapshot), ''), s.name) AS new_name
    FROM wanted w
    JOIN LATERAL (
      SELECT id, name, name_snapshot
      FROM sites
      WHERE deleted_at IS NULL
        AND status = 'active'
        AND lower(btrim(COALESCE(NULLIF(btrim(name_snapshot), ''), name))) = lower(w.wanted_name)
      ORDER BY id
      LIMIT 1
    ) s ON true
    WHERE w.wanted_name IS NOT NULL
      AND w.site_id IS DISTINCT FROM s.id
  LOOP
    UPDATE validation_reports
    SET site_id = rec.new_site_id
    WHERE id = rec.id
      AND site_id IS DISTINCT FROM rec.new_site_id;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;
    INSERT INTO audit_trail (entity_type, entity_id, action, changes)
    VALUES (
      'Validation Report',
      rec.id,
      'update',
      jsonb_build_object(
        'event', 'site_repaired',
        'siteId', rec.new_site_id,
        'siteName', rec.new_name,
        'previousSiteId', rec.old_site_id,
        'summary', 'Plant set from the name on the record.'
      )
    );
    repaired := repaired + 1;
  END LOOP;
  RETURN repaired;
END;
$$;

SELECT repair_validation_site_ids();
