-- Nest the Documents tree under ISO Compliance Documents.
-- Does nothing when document_folders is empty, so a brand-new company still
-- receives the full seed from the folder list (defaultDocumentFolders.ts).
-- Library Pool stays a real root. Blank Form Templates stays under ISO.
-- Saved files, form filings, and blank-template rows are repointed before a
-- duplicate folder is removed. A folder that itself holds a file is kept.

CREATE OR REPLACE FUNCTION accuqual_merge_document_folder(source_id integer, dest_id integer) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  child record;
  existing_id integer;
  dest_under_source boolean;
BEGIN
  IF source_id IS NULL OR dest_id IS NULL OR source_id = dest_id THEN
    RETURN;
  END IF;

  WITH RECURSIVE walk AS (
    SELECT id, 0 AS depth FROM document_folders WHERE id = source_id
    UNION ALL
    SELECT c.id, w.depth + 1
    FROM document_folders c
    JOIN walk w ON c.parent_id = w.id
    WHERE w.depth < 50
  )
  SELECT EXISTS (SELECT 1 FROM walk WHERE id = dest_id) INTO dest_under_source;
  IF dest_under_source THEN
    RETURN;
  END IF;

  FOR child IN
    SELECT id, name FROM document_folders WHERE parent_id = source_id ORDER BY sort_order, id
  LOOP
    SELECT id INTO existing_id
    FROM document_folders
    WHERE parent_id = dest_id AND name = child.name
    ORDER BY id
    LIMIT 1;
    IF existing_id IS NULL THEN
      UPDATE document_folders SET parent_id = dest_id WHERE id = child.id;
    ELSE
      PERFORM accuqual_merge_document_folder(child.id, existing_id);
    END IF;
  END LOOP;

  UPDATE form_filings SET folder_node_id = dest_id WHERE folder_node_id = source_id;
  UPDATE controlled_form_templates SET folder_id = dest_id WHERE folder_id = source_id;

  -- A saved file on the source folder moves onto the empty destination, instead of nesting a second copy.
  IF NOT EXISTS (SELECT 1 FROM document_folders WHERE parent_id = source_id)
     AND EXISTS (
       SELECT 1 FROM document_folders
       WHERE id = source_id AND (pdf_path IS NOT NULL OR document_id IS NOT NULL OR linked_path IS NOT NULL)
     )
     AND NOT EXISTS (
       SELECT 1 FROM document_folders
       WHERE id = dest_id AND (pdf_path IS NOT NULL OR document_id IS NOT NULL OR linked_path IS NOT NULL)
     )
  THEN
    UPDATE document_folders AS dest
    SET pdf_path = src.pdf_path,
        pdf_mime_type = src.pdf_mime_type,
        document_id = src.document_id,
        linked_path = src.linked_path
    FROM document_folders AS src
    WHERE dest.id = dest_id AND src.id = source_id;
    UPDATE document_folders
    SET pdf_path = NULL, pdf_mime_type = NULL, document_id = NULL, linked_path = NULL
    WHERE id = source_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM document_folders
    WHERE id = source_id
      AND (pdf_path IS NOT NULL OR document_id IS NOT NULL OR linked_path IS NOT NULL)
  ) THEN
    UPDATE document_folders SET parent_id = dest_id WHERE id = source_id;
  ELSIF NOT EXISTS (SELECT 1 FROM document_folders WHERE parent_id = source_id) THEN
    DELETE FROM document_folders WHERE id = source_id;
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE
  iso_id integer;
  dest_id integer;
  keeper_id integer;
  sop_id integer;
  audits_id integer;
  safety_id integer;
  existing_id integer;
  removed integer;
  module_name text;
  q record;
  src record;
  fai record;
  extra record;
  prod record;
  safety record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM document_folders) THEN
    RETURN;
  END IF;

  SELECT id INTO iso_id
  FROM document_folders
  WHERE parent_id IS NULL AND name = 'ISO Compliance Documents'
  ORDER BY id
  LIMIT 1;

  IF iso_id IS NULL THEN
    SELECT id INTO iso_id
    FROM document_folders
    WHERE name = 'ISO Compliance Documents'
    ORDER BY id
    LIMIT 1;
    IF iso_id IS NULL THEN
      INSERT INTO document_folders (name, parent_id, sort_order)
      VALUES ('ISO Compliance Documents', NULL, 0)
      RETURNING id INTO iso_id;
    ELSE
      UPDATE document_folders SET parent_id = NULL, sort_order = 0 WHERE id = iso_id;
    END IF;
  END IF;

  UPDATE document_folders
  SET parent_id = iso_id
  WHERE parent_id IS NULL
    AND id <> iso_id
    AND name <> 'Library Pool'
    AND name <> 'ISO Compliance Documents';

  UPDATE document_folders SET sort_order = 0 WHERE id = iso_id;

  FOREACH module_name IN ARRAY ARRAY[
    'Audits', 'Training', 'Safety', 'Production', 'CAPA', 'NCR', '8D',
    'Work Instruction', 'Procedures', 'SOP'
  ]
  LOOP
    IF NOT EXISTS (SELECT 1 FROM document_folders WHERE parent_id = iso_id AND name = module_name) THEN
      INSERT INTO document_folders (name, parent_id, sort_order)
      VALUES (module_name, iso_id, 50);
    END IF;
  END LOOP;

  -- Quality must not keep its own CAPA, NCR, or 8D. Those drawers live under ISO.
  FOR q IN SELECT id FROM document_folders WHERE name = 'Quality' LOOP
    FOREACH module_name IN ARRAY ARRAY['CAPA', 'NCR', '8D'] LOOP
      SELECT id INTO dest_id
      FROM document_folders
      WHERE parent_id = iso_id AND name = module_name
      ORDER BY id
      LIMIT 1;
      FOR src IN
        SELECT id FROM document_folders
        WHERE parent_id = q.id AND name = module_name
        ORDER BY id
      LOOP
        PERFORM accuqual_merge_document_folder(src.id, dest_id);
      END LOOP;
    END LOOP;
  END LOOP;

  -- Audits leaves Quality and keeps the subfolders it already has.
  SELECT id INTO audits_id
  FROM document_folders
  WHERE parent_id = iso_id AND name = 'Audits'
  ORDER BY id
  LIMIT 1;
  FOR src IN
    SELECT child.id
    FROM document_folders child
    JOIN document_folders parent_folder ON parent_folder.id = child.parent_id AND parent_folder.name = 'Quality'
    WHERE child.name = 'Audits'
    ORDER BY child.id
  LOOP
    PERFORM accuqual_merge_document_folder(src.id, audits_id);
  END LOOP;

  -- Training leaves Production. Subfolders stay on the ISO Training folder.
  SELECT id INTO dest_id
  FROM document_folders
  WHERE parent_id = iso_id AND name = 'Training'
  ORDER BY id
  LIMIT 1;
  FOR prod IN SELECT id FROM document_folders WHERE name = 'Production' LOOP
    FOR src IN
      SELECT id FROM document_folders
      WHERE parent_id = prod.id
        AND name IN ('Training & Competency', 'Training and Competency', 'Training')
      ORDER BY id
    LOOP
      PERFORM accuqual_merge_document_folder(src.id, dest_id);
    END LOOP;
  END LOOP;

  -- Safety leaves Production.
  SELECT id INTO safety_id
  FROM document_folders
  WHERE parent_id = iso_id AND name = 'Safety'
  ORDER BY id
  LIMIT 1;
  FOR prod IN SELECT id FROM document_folders WHERE name = 'Production' LOOP
    FOR src IN
      SELECT id FROM document_folders
      WHERE parent_id = prod.id
        AND name IN ('Safety & Compliance', 'Safety')
      ORDER BY id
    LOOP
      PERFORM accuqual_merge_document_folder(src.id, safety_id);
    END LOOP;
  END LOOP;

  -- Safety audits sit with the other audit folders.
  SELECT id INTO audits_id
  FROM document_folders
  WHERE parent_id = iso_id AND name = 'Audits'
  ORDER BY id
  LIMIT 1;
  FOR safety IN
    SELECT id FROM document_folders WHERE parent_id = iso_id AND name = 'Safety'
  LOOP
    FOR src IN
      SELECT id FROM document_folders WHERE parent_id = safety.id AND name = 'Safety Audits' ORDER BY id
    LOOP
      existing_id := NULL;
      SELECT id INTO existing_id
      FROM document_folders
      WHERE parent_id = audits_id AND name = 'Safety Audits'
      ORDER BY id
      LIMIT 1;
      IF existing_id IS NULL THEN
        UPDATE document_folders SET parent_id = audits_id WHERE id = src.id;
      ELSE
        PERFORM accuqual_merge_document_folder(src.id, existing_id);
      END IF;
    END LOOP;
  END LOOP;

  -- One CSA under each FAI. Keep the copy that already holds more of the tree.
  FOR fai IN SELECT id FROM document_folders WHERE name = 'FAI' LOOP
    keeper_id := NULL;
    SELECT child.id INTO keeper_id
    FROM document_folders child
    WHERE child.parent_id = fai.id AND child.name = 'CSA'
    ORDER BY (
      SELECT count(*) FROM document_folders descendant WHERE descendant.id = child.id OR descendant.parent_id = child.id
    ) DESC, child.id ASC
    LIMIT 1;
    IF keeper_id IS NULL THEN
      CONTINUE;
    END IF;
    FOR extra IN
      SELECT id FROM document_folders
      WHERE parent_id = fai.id AND name = 'CSA' AND id <> keeper_id
      ORDER BY id
    LOOP
      PERFORM accuqual_merge_document_folder(extra.id, keeper_id);
    END LOOP;
  END LOOP;

  -- Remove PCB, and empty folders that exist only inside a PCB branch.
  LOOP
    DELETE FROM document_folders d
    WHERE d.id IN (
      WITH RECURSIVE pcb AS (
        SELECT id FROM document_folders WHERE name IN ('PCB', 'PCB Layouts')
        UNION ALL
        SELECT c.id FROM document_folders c JOIN pcb p ON c.parent_id = p.id
      ),
      doomed AS (
        SELECT p.id
        FROM pcb p
        WHERE NOT EXISTS (
          WITH RECURSIVE sub AS (
            SELECT id, 0 AS depth FROM document_folders WHERE id = p.id
            UNION ALL
            SELECT c.id, s.depth + 1 FROM document_folders c JOIN sub s ON c.parent_id = s.id WHERE s.depth < 50
          )
          SELECT 1
          FROM sub s
          JOIN document_folders f ON f.id = s.id
          WHERE f.pdf_path IS NOT NULL
             OR f.document_id IS NOT NULL
             OR f.linked_path IS NOT NULL
             OR EXISTS (SELECT 1 FROM form_filings ff WHERE ff.folder_node_id = f.id)
             OR EXISTS (SELECT 1 FROM controlled_form_templates ct WHERE ct.folder_id = f.id)
        )
      )
      SELECT doomed.id
      FROM doomed
      WHERE NOT EXISTS (SELECT 1 FROM document_folders child WHERE child.parent_id = doomed.id)
    );
    GET DIAGNOSTICS removed = ROW_COUNT;
    EXIT WHEN removed = 0;
  END LOOP;

  -- Production keeps the folder and drops empty leftovers. Anything with a saved file stays.
  LOOP
    DELETE FROM document_folders d
    WHERE d.id IN (
      WITH RECURSIVE under_prod AS (
        SELECT folder_row.id, 0 AS depth
        FROM document_folders folder_row
        JOIN document_folders production_row ON production_row.id = folder_row.parent_id
        WHERE production_row.name = 'Production' AND production_row.parent_id = iso_id
        UNION ALL
        SELECT c.id, u.depth + 1
        FROM document_folders c
        JOIN under_prod u ON c.parent_id = u.id
        WHERE u.depth < 50
      ),
      doomed AS (
        SELECT u.id
        FROM under_prod u
        WHERE NOT EXISTS (
          WITH RECURSIVE sub AS (
            SELECT id, 0 AS depth FROM document_folders WHERE id = u.id
            UNION ALL
            SELECT c.id, s.depth + 1 FROM document_folders c JOIN sub s ON c.parent_id = s.id WHERE s.depth < 50
          )
          SELECT 1
          FROM sub s
          JOIN document_folders f ON f.id = s.id
          WHERE f.pdf_path IS NOT NULL
             OR f.document_id IS NOT NULL
             OR f.linked_path IS NOT NULL
             OR EXISTS (SELECT 1 FROM form_filings ff WHERE ff.folder_node_id = f.id)
             OR EXISTS (SELECT 1 FROM controlled_form_templates ct WHERE ct.folder_id = f.id)
        )
      )
      SELECT doomed.id
      FROM doomed
      WHERE NOT EXISTS (SELECT 1 FROM document_folders child WHERE child.parent_id = doomed.id)
    );
    GET DIAGNOSTICS removed = ROW_COUNT;
    EXIT WHEN removed = 0;
  END LOOP;

  SELECT id INTO sop_id
  FROM document_folders
  WHERE parent_id = iso_id AND name = 'SOP'
  ORDER BY id
  LIMIT 1;
  IF sop_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM document_folders WHERE parent_id = sop_id AND name = 'Policies') THEN
    INSERT INTO document_folders (name, parent_id, sort_order) VALUES ('Policies', sop_id, 0);
  END IF;
  IF sop_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM document_folders WHERE parent_id = sop_id AND name = 'Procedures') THEN
    INSERT INTO document_folders (name, parent_id, sort_order) VALUES ('Procedures', sop_id, 1);
  END IF;

  UPDATE document_folders AS child
  SET sort_order = wanted.ord
  FROM (
    VALUES
      ('Engineering', 0),
      ('Quality', 1),
      ('Audits', 2),
      ('Training', 3),
      ('Safety', 4),
      ('Production', 5),
      ('CAPA', 6),
      ('NCR', 7),
      ('8D', 8),
      ('Work Instruction', 9),
      ('Procedures', 10),
      ('SOP', 11),
      ('Material Management', 12),
      ('Shipping & Receiving', 13)
  ) AS wanted(name, ord)
  WHERE child.parent_id = iso_id AND child.name = wanted.name;

  UPDATE document_folders AS child
  SET sort_order = CASE child.name WHEN 'Policies' THEN 0 WHEN 'Procedures' THEN 1 ELSE child.sort_order END
  FROM document_folders sop
  WHERE sop.parent_id = iso_id AND sop.name = 'SOP' AND child.parent_id = sop.id AND child.name IN ('Policies', 'Procedures');
END $$;
--> statement-breakpoint
DROP FUNCTION IF EXISTS accuqual_merge_document_folder(integer, integer);
