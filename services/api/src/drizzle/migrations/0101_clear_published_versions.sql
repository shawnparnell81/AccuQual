-- Clear published and archived controlled versions left from testing.
--
-- controlled_versions_freeze rejects a normal DELETE of those rows. This turns
-- that guard off, clears the pointers that would still show a released revision
-- as in force, removes the rows, and turns the guard back on. A subject that
-- would otherwise have no version left keeps one draft of its latest released
-- content, so opening it does not bootstrap a new published version.
--
-- Workflow definitions, NCR steps, form layouts, blank form templates, the
-- folder tree, users, roles, and permissions are not changed. Safe to run once.

DO $$
DECLARE
  freeze_exists boolean;
BEGIN
  -- The freeze trigger is installed by post-migrate after the migration files, so a brand-new
  -- database does not have it yet. A database that has already been migrated does, and it blocks this delete.
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'controlled_versions_freeze' AND tgrelid = 'controlled_versions'::regclass
  ) INTO freeze_exists;
  IF freeze_exists THEN
    ALTER TABLE controlled_versions DISABLE TRIGGER controlled_versions_freeze;
  END IF;
  ALTER TABLE controlled_versions DISABLE TRIGGER archived_document_versions_readonly;
  ALTER TABLE documents DISABLE TRIGGER documents_archive_readonly;
  ALTER TABLE document_versions DISABLE TRIGGER archived_document_ledger_readonly;

  -- Latest released payload for a subject whose only versions are published or archived.
  -- Kept so the delete below does not leave the subject empty (which the app would reopen as published).
  CREATE TEMP TABLE released_without_open ON COMMIT DROP AS
  SELECT DISTINCT ON (cv.subject_type, cv.subject_id)
    cv.subject_type,
    cv.subject_id,
    cv.payload,
    cv.created_by
  FROM controlled_versions cv
  WHERE cv.status IN ('published', 'archived')
    AND NOT (
      cv.subject_type = 'document'
      AND EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = cv.subject_id AND d.status = 'obsolete' AND d.category = 'obsolete-archive'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM controlled_versions open_row
      WHERE open_row.subject_type = cv.subject_type
        AND open_row.subject_id = cv.subject_id
        AND open_row.status IN ('draft', 'in_review')
    )
  ORDER BY cv.subject_type, cv.subject_id, cv.version_number DESC;

  UPDATE document_comments
  SET version_id = NULL
  WHERE version_id IN (
    SELECT id FROM controlled_versions WHERE status IN ('published', 'archived')
  );

  -- The release ledger is what revision history shows as a released file once the controlled row is gone.
  DELETE FROM document_versions dv
  USING documents d
  WHERE dv.document_id = d.id
    AND (
      d.status = 'approved'
      OR d.current_version > 0
      OR d.current_version_id IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM controlled_versions cv
        WHERE cv.subject_type = 'document'
          AND cv.subject_id = d.id
          AND cv.status IN ('published', 'archived')
      )
    );

  UPDATE documents d
  SET
    current_version_id = NULL,
    current_version = 0,
    revision_code = NULL,
    effective_date = NULL,
    status = CASE
      WHEN d.status = 'obsolete' THEN d.status
      WHEN EXISTS (
        SELECT 1
        FROM controlled_versions cv
        WHERE cv.subject_type = 'document'
          AND cv.subject_id = d.id
          AND cv.status = 'in_review'
      ) THEN 'in_review'
      WHEN d.status = 'in_review' THEN d.status
      ELSE 'draft'
    END,
    updated_at = now()
  WHERE d.status = 'approved'
     OR d.current_version > 0
     OR d.current_version_id IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM controlled_versions cv
       WHERE cv.subject_type = 'document'
         AND cv.subject_id = d.id
         AND cv.status IN ('published', 'archived')
     );

  DELETE FROM audit_trail
  WHERE entity_type IN ('DocumentVersion', 'WorkflowVersion', 'ManagementReviewVersion', 'ContextVersion')
    AND COALESCE(changes->>'event', '') = 'published';

  DELETE FROM controlled_versions
  WHERE status IN ('published', 'archived');

  INSERT INTO controlled_versions (
    subject_type, subject_id, version_number, status, payload, metadata, created_by, created_at
  )
  SELECT
    subject_type,
    subject_id,
    1,
    'draft',
    payload,
    '{}'::jsonb,
    created_by,
    now()
  FROM released_without_open;

  IF freeze_exists THEN
    ALTER TABLE controlled_versions ENABLE TRIGGER controlled_versions_freeze;
  END IF;
  ALTER TABLE controlled_versions ENABLE TRIGGER archived_document_versions_readonly;
  ALTER TABLE documents ENABLE TRIGGER documents_archive_readonly;
  ALTER TABLE document_versions ENABLE TRIGGER archived_document_ledger_readonly;
END $$;
