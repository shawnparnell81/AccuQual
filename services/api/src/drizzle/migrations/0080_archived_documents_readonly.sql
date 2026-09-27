-- Obsolete / Archive is read-only in the database, including for an administrator.
-- The only update allowed is a restore, and only in a transaction that sets
-- accuqual.restore_document to that document's id (POST /documents/:id/restore).
-- Revision rows and stored files cannot be rewritten while the document is archived.

UPDATE "roles"
SET "permissions" = "permissions" || '["restore_archived_documents"]'::jsonb
WHERE "name" IN ('owner', 'admin')
  AND NOT ("permissions" @> '["restore_archived_documents"]'::jsonb);--> statement-breakpoint

CREATE OR REPLACE FUNCTION documents_archive_readonly() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (OLD.status = 'obsolete' AND OLD.category = 'obsolete-archive') THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'An archived document cannot be deleted' USING ERRCODE = '23000';
  END IF;

  IF current_setting('accuqual.restore_document', true) IS DISTINCT FROM OLD.id::text
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.is_deleted IS DISTINCT FROM OLD.is_deleted
     OR NEW.current_version IS DISTINCT FROM OLD.current_version
     OR NEW.current_version_id IS DISTINCT FROM OLD.current_version_id
     OR NEW.revision_code IS DISTINCT FROM OLD.revision_code
     OR NEW.effective_date IS DISTINCT FROM OLD.effective_date
     OR NEW.expiration_date IS DISTINCT FROM OLD.expiration_date
     OR NEW.expiration_warning_days IS DISTINCT FROM OLD.expiration_warning_days
     OR NEW.retention_period_days IS DISTINCT FROM OLD.retention_period_days
     OR NEW.retention_action IS DISTINCT FROM OLD.retention_action
     OR NEW.retention_state IS DISTINCT FROM OLD.retention_state
     OR NEW.tags IS DISTINCT FROM OLD.tags
     OR NEW.linked_modules IS DISTINCT FROM OLD.linked_modules
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (NEW.status = 'obsolete' AND NEW.category = 'obsolete-archive') THEN
    RAISE EXCEPTION 'An archived document is read-only' USING ERRCODE = '23000';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS documents_archive_readonly ON documents;--> statement-breakpoint
CREATE TRIGGER documents_archive_readonly
  BEFORE UPDATE OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_archive_readonly();--> statement-breakpoint

CREATE OR REPLACE FUNCTION archived_document_versions_readonly() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  subject_id integer;
  subject_type text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    subject_id := NEW.subject_id;
    subject_type := NEW.subject_type;
  ELSE
    subject_id := OLD.subject_id;
    subject_type := OLD.subject_type;
  END IF;

  IF subject_type = 'document' AND EXISTS (
    SELECT 1 FROM documents
    WHERE id = subject_id AND status = 'obsolete' AND category = 'obsolete-archive'
  ) THEN
    RAISE EXCEPTION 'An archived document cannot be revised' USING ERRCODE = '23000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS archived_document_versions_readonly ON controlled_versions;--> statement-breakpoint
CREATE TRIGGER archived_document_versions_readonly
  BEFORE INSERT OR UPDATE OR DELETE ON controlled_versions
  FOR EACH ROW EXECUTE FUNCTION archived_document_versions_readonly();--> statement-breakpoint

CREATE OR REPLACE FUNCTION archived_document_files_readonly() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  doc_id integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    doc_id := NEW.document_id;
  ELSE
    doc_id := OLD.document_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM documents
    WHERE id = doc_id AND status = 'obsolete' AND category = 'obsolete-archive'
  ) THEN
    RAISE EXCEPTION 'An archived document cannot have files added or removed' USING ERRCODE = '23000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS archived_document_files_readonly ON document_files;--> statement-breakpoint
CREATE TRIGGER archived_document_files_readonly
  BEFORE INSERT OR UPDATE OR DELETE ON document_files
  FOR EACH ROW EXECUTE FUNCTION archived_document_files_readonly();--> statement-breakpoint

CREATE OR REPLACE FUNCTION archived_document_ledger_readonly() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  doc_id integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    doc_id := NEW.document_id;
  ELSE
    doc_id := OLD.document_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM documents
    WHERE id = doc_id AND status = 'obsolete' AND category = 'obsolete-archive'
  ) THEN
    RAISE EXCEPTION 'An archived document''s revision ledger cannot be changed' USING ERRCODE = '23000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS archived_document_ledger_readonly ON document_versions;--> statement-breakpoint
CREATE TRIGGER archived_document_ledger_readonly
  BEFORE INSERT OR UPDATE OR DELETE ON document_versions
  FOR EACH ROW EXECUTE FUNCTION archived_document_ledger_readonly();
