-- DCR-F-001 fields on the Document Changes record.
-- Older columns and the item/review tables stay so saved rows are not deleted.
-- Closest old answers are copied onto the paper columns. SIGN cells stay empty:
-- a typed name is not a PIN signature. Checkbox groups stay unchecked when the
-- old record did not store New / Revision / Cancellation or a document type.
ALTER TABLE "document_change_requests" ADD COLUMN IF NOT EXISTS "requester_name" text;
ALTER TABLE "document_change_requests" ADD COLUMN IF NOT EXISTS "requester_title" text;
ALTER TABLE "document_change_requests" ADD COLUMN IF NOT EXISTS "action_new" boolean DEFAULT false NOT NULL;
ALTER TABLE "document_change_requests" ADD COLUMN IF NOT EXISTS "action_revision" boolean DEFAULT false NOT NULL;
ALTER TABLE "document_change_requests" ADD COLUMN IF NOT EXISTS "action_cancellation" boolean DEFAULT false NOT NULL;
ALTER TABLE "document_change_requests" ADD COLUMN IF NOT EXISTS "doc_type_sop" boolean DEFAULT false NOT NULL;
ALTER TABLE "document_change_requests" ADD COLUMN IF NOT EXISTS "doc_type_bulletin" boolean DEFAULT false NOT NULL;
ALTER TABLE "document_change_requests" ADD COLUMN IF NOT EXISTS "doc_type_template" boolean DEFAULT false NOT NULL;
ALTER TABLE "document_change_requests" ADD COLUMN IF NOT EXISTS "doc_type_form" boolean DEFAULT false NOT NULL;
ALTER TABLE "document_change_requests" ADD COLUMN IF NOT EXISTS "document_process_name" text;
ALTER TABLE "document_change_requests" ADD COLUMN IF NOT EXISTS "current_doc_number" text;
ALTER TABLE "document_change_requests" ADD COLUMN IF NOT EXISTS "current_doc_rev" text;
ALTER TABLE "document_change_requests" ADD COLUMN IF NOT EXISTS "current_doc_rev_date" timestamp;
ALTER TABLE "document_change_requests" ADD COLUMN IF NOT EXISTS "change_description" text;
ALTER TABLE "document_change_requests" ADD COLUMN IF NOT EXISTS "new_doc_number" text;
ALTER TABLE "document_change_requests" ADD COLUMN IF NOT EXISTS "new_doc_rev" text;
ALTER TABLE "document_change_requests" ADD COLUMN IF NOT EXISTS "new_rev_date" timestamp;
ALTER TABLE "document_change_requests" ADD COLUMN IF NOT EXISTS "requester_approval_signature" text;
ALTER TABLE "document_change_requests" ADD COLUMN IF NOT EXISTS "requester_approval_date" timestamp;
ALTER TABLE "document_change_requests" ADD COLUMN IF NOT EXISTS "vp_approval_signature" text;
ALTER TABLE "document_change_requests" ADD COLUMN IF NOT EXISTS "vp_approval_date" timestamp;
ALTER TABLE "document_change_requests" ADD COLUMN IF NOT EXISTS "request_executed_by" text;
ALTER TABLE "document_change_requests" ADD COLUMN IF NOT EXISTS "request_executed_title" text;
ALTER TABLE "document_change_requests" ADD COLUMN IF NOT EXISTS "request_executed_date" timestamp;
--> statement-breakpoint
DO $$
DECLARE
  rec record;
  item record;
  revw record;
  first_item_id integer;
  first_reason text;
  note text;
  line text;
  lines text[];
BEGIN
  FOR rec IN SELECT * FROM document_change_requests ORDER BY id LOOP
    SELECT id INTO first_item_id
    FROM document_change_items
    WHERE document_change_request_id = rec.id
    ORDER BY id
    LIMIT 1;

    IF (rec.requester_name IS NULL OR btrim(rec.requester_name) = '')
       AND rec.prepared_by IS NOT NULL AND btrim(rec.prepared_by) <> '' THEN
      UPDATE document_change_requests
      SET requester_name = btrim(rec.prepared_by)
      WHERE id = rec.id;
      rec.requester_name := btrim(rec.prepared_by);
    END IF;

    IF first_item_id IS NOT NULL THEN
      SELECT * INTO item FROM document_change_items WHERE id = first_item_id;

      IF (rec.document_process_name IS NULL OR btrim(rec.document_process_name) = '')
         AND item.document_process IS NOT NULL AND btrim(item.document_process) <> '' THEN
        UPDATE document_change_requests SET document_process_name = btrim(item.document_process) WHERE id = rec.id;
      END IF;

      IF (rec.current_doc_rev IS NULL OR btrim(rec.current_doc_rev) = '')
         AND item.current_revision IS NOT NULL AND btrim(item.current_revision) <> '' THEN
        UPDATE document_change_requests SET current_doc_rev = btrim(item.current_revision) WHERE id = rec.id;
      END IF;

      IF (rec.new_doc_rev IS NULL OR btrim(rec.new_doc_rev) = '')
         AND item.proposed_revision IS NOT NULL AND btrim(item.proposed_revision) <> '' THEN
        UPDATE document_change_requests SET new_doc_rev = btrim(item.proposed_revision) WHERE id = rec.id;
      END IF;

      IF (rec.requester_name IS NULL OR btrim(rec.requester_name) = '')
         AND item.requested_by IS NOT NULL AND btrim(item.requested_by) <> '' THEN
        UPDATE document_change_requests SET requester_name = btrim(item.requested_by) WHERE id = rec.id;
        rec.requester_name := btrim(item.requested_by);
      END IF;
    END IF;

    IF rec.change_description IS NULL OR btrim(rec.change_description) = '' THEN
      IF rec.additional_comments IS NOT NULL AND btrim(rec.additional_comments) <> '' THEN
        UPDATE document_change_requests SET change_description = rec.additional_comments WHERE id = rec.id;
        rec.change_description := rec.additional_comments;
      ELSIF first_item_id IS NOT NULL THEN
        SELECT reason INTO first_reason FROM document_change_items WHERE id = first_item_id;
        IF first_reason IS NOT NULL AND btrim(first_reason) <> '' THEN
          UPDATE document_change_requests SET change_description = btrim(first_reason) WHERE id = rec.id;
          rec.change_description := btrim(first_reason);
        END IF;
      END IF;
    END IF;

    lines := ARRAY[]::text[];

    IF rec.form_no IS NOT NULL AND btrim(rec.form_no) <> '' THEN
      lines := array_append(lines, 'Form No.: ' || btrim(rec.form_no));
    END IF;
    IF rec.approved_by IS NOT NULL AND btrim(rec.approved_by) <> '' THEN
      lines := array_append(lines, 'Approved By: ' || btrim(rec.approved_by));
    END IF;
    IF rec.effective_date IS NOT NULL THEN
      lines := array_append(lines, 'Effective Date: ' || to_char(rec.effective_date, 'YYYY-MM-DD'));
    END IF;
    IF rec.status IN ('active', 'obsolete') THEN
      lines := array_append(lines, 'Status: ' || rec.status);
    END IF;

    FOR item IN
      SELECT i.*, row_number() OVER (ORDER BY i.id) AS ord
      FROM document_change_items i
      WHERE i.document_change_request_id = rec.id
      ORDER BY i.id
    LOOP
      line := NULL;
      IF item.change_id IS NOT NULL AND btrim(item.change_id) <> '' THEN
        line := concat_ws(' | ', line, 'Change ID ' || btrim(item.change_id));
      END IF;
      IF item.ord > 1 THEN
        IF item.document_process IS NOT NULL AND btrim(item.document_process) <> '' THEN
          line := concat_ws(' | ', line, btrim(item.document_process));
        END IF;
        IF item.current_revision IS NOT NULL AND btrim(item.current_revision) <> '' THEN
          line := concat_ws(' | ', line, 'Cur Rev ' || btrim(item.current_revision));
        END IF;
        IF item.proposed_revision IS NOT NULL AND btrim(item.proposed_revision) <> '' THEN
          line := concat_ws(' | ', line, 'Prop Rev ' || btrim(item.proposed_revision));
        END IF;
        IF item.requested_by IS NOT NULL AND btrim(item.requested_by) <> '' THEN
          line := concat_ws(' | ', line, 'Requested by ' || btrim(item.requested_by));
        END IF;
      ELSIF item.requested_by IS NOT NULL AND btrim(item.requested_by) <> ''
            AND btrim(item.requested_by) IS DISTINCT FROM COALESCE(rec.requester_name, '') THEN
        line := concat_ws(' | ', line, 'Requested by ' || btrim(item.requested_by));
      END IF;

      IF item.reason IS NOT NULL AND btrim(item.reason) <> ''
         AND NOT (item.ord = 1 AND COALESCE(btrim(rec.change_description), '') = btrim(item.reason)) THEN
        line := concat_ws(' | ', line, btrim(item.reason));
      END IF;

      IF line IS NOT NULL AND btrim(line) <> '' THEN
        lines := array_append(lines, line);
      END IF;
    END LOOP;

    FOR revw IN
      SELECT * FROM document_change_reviews
      WHERE document_change_request_id = rec.id
      ORDER BY id
    LOOP
      line := concat_ws(' | ',
        CASE WHEN revw.reviewer IS NOT NULL AND btrim(revw.reviewer) <> '' THEN 'Reviewer ' || btrim(revw.reviewer) END,
        CASE WHEN revw.decision IS NOT NULL AND btrim(revw.decision) <> '' THEN 'Decision ' || btrim(revw.decision) END,
        CASE WHEN revw.comments IS NOT NULL AND btrim(revw.comments) <> '' THEN btrim(revw.comments) END,
        CASE WHEN revw.review_date IS NOT NULL THEN 'Date ' || to_char(revw.review_date, 'YYYY-MM-DD') END
      );
      IF line IS NOT NULL AND btrim(line) <> '' THEN
        lines := array_append(lines, line);
      END IF;
    END LOOP;

    IF cardinality(lines) > 0
       AND (rec.change_description IS NULL OR position('Kept from the previous document change layout:' IN rec.change_description) = 0) THEN
      note := 'Kept from the previous document change layout:' || E'\n' || array_to_string(lines, E'\n');
      UPDATE document_change_requests
      SET change_description = concat_ws(E'\n\n', NULLIF(btrim(change_description), ''), note)
      WHERE id = rec.id;
    END IF;
  END LOOP;
END $$;
