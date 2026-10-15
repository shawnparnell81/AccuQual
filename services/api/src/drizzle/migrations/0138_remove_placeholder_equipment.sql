-- One-off, idempotent clean-up. Opening the blank Calibration forms used to create
-- equipment rows named after the form ("Calibration Record", "Calibration Equipment
-- Register" or blank). Those were never real gages. A row is removed only when all of
-- these hold: the name is one of those form names, serial, location and type are blank,
-- the status is the untouched default, the interval is the 365-day default, metadata
-- carries no value, it has no calibration, no attachment, no saved form and no version
-- history, and no other table points at it. Never-saved form stubs for a removed row go
-- with it. Each removal is written to the audit trail. A second run changes nothing.

CREATE OR REPLACE FUNCTION remove_placeholder_equipment() RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  rec record;
  ref record;
  linked boolean;
  removed integer := 0;
BEGIN
  FOR rec IN
    SELECT e.id, e.name
    FROM equipment e
    WHERE lower(btrim(COALESCE(e.name, ''))) IN ('', 'calibration record', 'calibration equipment register')
      AND btrim(COALESCE(e.serial_number, '')) = ''
      AND btrim(COALESCE(e.location, '')) = ''
      AND btrim(COALESCE(e.type, '')) = ''
      AND e.status = 'active'
      AND btrim(COALESCE(e.status_reason, '')) = ''
      AND e.calibration_interval_days = 365
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_each(COALESCE(e.metadata, '{}'::jsonb)) m
        WHERE m.value NOT IN ('null'::jsonb, '""'::jsonb, '{}'::jsonb, '[]'::jsonb)
      )
      AND NOT EXISTS (SELECT 1 FROM calibrations c WHERE c.equipment_id = e.id)
      AND NOT EXISTS (
        SELECT 1 FROM attachments a
        WHERE a.entity_id = e.id AND a.entity_type IN ('calibration', 'equipment', 'gage_rr', 'maintenance_work_order')
      )
      AND NOT EXISTS (
        SELECT 1 FROM form_data f
        WHERE f.entity_id = e.id
          AND f.form_type IN ('calibration', 'gage_rr', 'maintenance_work_order')
          AND (f.updated_at IS NOT NULL OR EXISTS (SELECT 1 FROM form_versions v WHERE v.form_id = f.id))
      )
    ORDER BY e.id
  LOOP
    -- Any other foreign key to equipment (now or added later) keeps the row.
    linked := false;
    FOR ref IN
      SELECT cl.relname AS tbl, att.attname AS col
      FROM pg_constraint con
      JOIN pg_class cl ON cl.oid = con.conrelid
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
      WHERE con.contype = 'f' AND con.confrelid = 'equipment'::regclass
    LOOP
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE %I = $1)', ref.tbl, ref.col) INTO linked USING rec.id;
      EXIT WHEN linked;
    END LOOP;
    IF linked THEN
      CONTINUE;
    END IF;

    DELETE FROM form_data
    WHERE entity_id = rec.id
      AND form_type IN ('calibration', 'gage_rr', 'maintenance_work_order')
      AND updated_at IS NULL;
    DELETE FROM equipment WHERE id = rec.id;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    INSERT INTO audit_trail (entity_type, entity_id, action, performed_by, changes)
    VALUES (
      'Equipment',
      rec.id,
      'delete',
      NULL,
      jsonb_build_object(
        'event', 'placeholder_removed',
        'who', 'System migration 0138_remove_placeholder_equipment',
        'what', 'Equipment ' || rec.id || ' "' || COALESCE(NULLIF(btrim(rec.name), ''), 'blank') || '"',
        'when', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC',
        'summary', 'System migration 0138_remove_placeholder_equipment removed blank calibration placeholder equipment ' || rec.id
          || ' ("' || COALESCE(NULLIF(btrim(rec.name), ''), 'blank') || '"). It had no serial, location, type, calibration, attachment or saved form. Its row on the Master Equipment List is removed the next time the list opens.'
      )
    );
    removed := removed + 1;
  END LOOP;
  RETURN removed;
END;
$$;
--> statement-breakpoint
SELECT remove_placeholder_equipment();
--> statement-breakpoint
DROP FUNCTION remove_placeholder_equipment();
