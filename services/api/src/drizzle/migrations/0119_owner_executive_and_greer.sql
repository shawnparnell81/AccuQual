-- Owner and Administrator start with View all sites and the executive dashboard.
-- The check reads the role's permission list. A role name does not grant them.
-- Each key is added only when it is missing, so a later edit that removes it stays removed.
-- This file adds no columns. The app keeps working if it is deployed before this runs.
--
-- When a living "Main plant" and a living "Greer" both exist, every row that
-- points at Main plant is moved to Greer. Production uses Main plant id 1 and
-- Greer id 6; other databases match the same names. Greer becomes the default
-- plant. Main plant is deactivated (status inactive) and is not deleted.
-- Rows with a null site stay null and keep showing as Unassigned.
-- Running this again does nothing once that move is finished.

UPDATE "roles"
SET "permissions" = "permissions" || '["sites.view_all"]'::jsonb
WHERE "name" IN ('owner', 'admin')
  AND NOT ("permissions" ? 'sites.view_all');
--> statement-breakpoint
UPDATE "roles"
SET "permissions" = "permissions" || '["executive.dashboard"]'::jsonb
WHERE "name" IN ('owner', 'admin')
  AND NOT ("permissions" ? 'executive.dashboard');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION accuqual_merge_main_plant_into_greer() RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  main_id int;
  greer_id int;
  main_status text;
  greer_is_default boolean;
  pending bigint := 0;
  pointing bigint;
  moved bigint;
  dupes bigint := 0;
  total_moved bigint := 0;
  rec record;
BEGIN
  SELECT s.id, s.status
  INTO main_id, main_status
  FROM sites s
  WHERE s.deleted_at IS NULL
    AND lower(btrim(s.name)) = 'main plant'
  ORDER BY CASE WHEN s.id = 1 THEN 0 ELSE 1 END,
           CASE WHEN s.status = 'active' THEN 0 ELSE 1 END,
           s.id
  LIMIT 1;

  SELECT s.id, s.is_default
  INTO greer_id, greer_is_default
  FROM sites s
  WHERE s.deleted_at IS NULL
    AND lower(btrim(s.name)) = 'greer'
  ORDER BY CASE WHEN s.id = 6 THEN 0 ELSE 1 END,
           CASE WHEN s.status = 'active' THEN 0 ELSE 1 END,
           s.id
  LIMIT 1;

  IF main_id IS NULL OR greer_id IS NULL OR main_id = greer_id THEN
    RETURN;
  END IF;

  FOR rec IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.column_name IN ('site_id', 'current_site_id')
      AND c.table_name <> 'sites'
  LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE %I = $1', rec.table_name, rec.column_name)
      INTO pointing
      USING main_id;
    pending := pending + COALESCE(pointing, 0);
  END LOOP;

  IF main_status IS DISTINCT FROM 'active' AND pending = 0 AND greer_is_default THEN
    RETURN;
  END IF;

  FOR rec IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.column_name IN ('site_id', 'current_site_id')
      AND c.table_name <> 'sites'
  LOOP
    IF rec.table_name = 'user_sites' AND rec.column_name = 'site_id' THEN
      UPDATE user_sites AS src
      SET site_id = greer_id
      WHERE src.site_id = main_id
        AND NOT EXISTS (
          SELECT 1 FROM user_sites AS dst
          WHERE dst.user_id = src.user_id AND dst.site_id = greer_id
        );
      GET DIAGNOSTICS moved = ROW_COUNT;
      total_moved := total_moved + moved;

      DELETE FROM user_sites WHERE site_id = main_id;
      GET DIAGNOSTICS dupes = ROW_COUNT;
    ELSE
      EXECUTE format('UPDATE %I SET %I = $1 WHERE %I = $2', rec.table_name, rec.column_name, rec.column_name)
        USING greer_id, main_id;
      GET DIAGNOSTICS moved = ROW_COUNT;
      total_moved := total_moved + moved;
    END IF;
  END LOOP;

  UPDATE sites
  SET is_default = false, updated_at = now()
  WHERE id <> greer_id AND is_default = true;

  UPDATE sites
  SET is_default = true, status = 'active', updated_at = now()
  WHERE id = greer_id;

  UPDATE sites
  SET status = 'inactive', is_default = false, updated_at = now()
  WHERE id = main_id AND deleted_at IS NULL;

  INSERT INTO audit_trail (entity_type, entity_id, action, changes, performed_by)
  VALUES (
    'Site',
    greer_id,
    'update',
    jsonb_build_object(
      'system', true,
      'summary', 'System change: records, people, and settings that pointed at Main plant now point at Greer. Greer is the default plant. Main plant was deactivated and was not deleted. Records with no site stayed Unassigned.',
      'fromSiteId', main_id,
      'fromSiteName', 'Main plant',
      'toSiteId', greer_id,
      'toSiteName', 'Greer',
      'rowsMoved', total_moved,
      'duplicateAssignmentsRemoved', dupes
    ),
    NULL
  );
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION accuqual_merge_main_plant_into_greer() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'accuqual_app') THEN
    REVOKE ALL ON FUNCTION accuqual_merge_main_plant_into_greer() FROM accuqual_app;
  END IF;
END $$;
--> statement-breakpoint
SELECT accuqual_merge_main_plant_into_greer();
