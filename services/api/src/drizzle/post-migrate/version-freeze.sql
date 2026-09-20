-- Version freeze for controlled_versions. Idempotent; run by db:migrate.
--
-- A published (or archived) version is a controlled record: what it said must
-- stay provable. This trigger enforces that in the database itself, so no
-- code path — a forgotten check, a future endpoint, SQL injection through the
-- app role — can rewrite or delete one. The only change a published row may
-- ever undergo is being archived once a newer version supersedes it.

CREATE OR REPLACE FUNCTION controlled_versions_freeze() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('published', 'archived') THEN
      RAISE EXCEPTION 'A published version cannot be deleted (version %)', OLD.version_number USING ERRCODE = '23000';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status IN ('published', 'archived') THEN
    IF NEW.payload IS DISTINCT FROM OLD.payload
       OR NEW.metadata IS DISTINCT FROM OLD.metadata
       OR NEW.version_number IS DISTINCT FROM OLD.version_number
       OR NEW.subject_type IS DISTINCT FROM OLD.subject_type
       OR NEW.subject_id IS DISTINCT FROM OLD.subject_id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.published_by IS DISTINCT FROM OLD.published_by
       OR NEW.published_at IS DISTINCT FROM OLD.published_at
       OR NEW.review_notes IS DISTINCT FROM OLD.review_notes
       OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by THEN
      RAISE EXCEPTION 'Version % is published and frozen — it cannot be edited', OLD.version_number USING ERRCODE = '23000';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'published' AND NEW.status = 'archived') THEN
      RAISE EXCEPTION 'A published version can only move to archived' USING ERRCODE = '23000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS controlled_versions_freeze ON controlled_versions;
CREATE TRIGGER controlled_versions_freeze
  BEFORE UPDATE OR DELETE ON controlled_versions
  FOR EACH ROW EXECUTE FUNCTION controlled_versions_freeze();
