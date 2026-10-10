import { eq, sql } from "drizzle-orm";
import { company } from "../../drizzle/schema/company.js";
import type { Db } from "../../lib/requestDb.js";

/**
 * A read of Folders or Documents used to file, relink, and rebuild on every
 * open. This remembers a fingerprint of the rows that repair looks at. When
 * the fingerprint matches, the read does not write. A missing filing, a wrong
 * link, or a day-old unsaved blank still takes the repair path once.
 */

const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

async function oneStamp(db: Db): Promise<string> {
  const result = await db.execute<{ stamp: string }>(sql`
    SELECT concat_ws('|',
      (SELECT count(*)::text || ':' || coalesce(sum(hashtext(id::text || ':' || form_key || ':' || record_id::text || ':' || coalesce(folder_node_id::text, '')))::text, '0') FROM form_filings),
      (SELECT count(*)::text || ':' || coalesce(sum(hashtext(id::text || ':' || coalesce(linked_path, '') || ':' || coalesce(parent_id::text, '')))::text, '0') FROM document_folders),
      (SELECT coalesce(max(id)::text, '') || ':' || coalesce(max(updated_at)::text, '') FROM validation_reports),
      (SELECT coalesce(max(id)::text, '') || ':' || coalesce(max(coalesce(updated_at, created_at))::text, '') FROM iso_quality_forms),
      (SELECT coalesce(max(id)::text, '') || ':' || coalesce(max(updated_at)::text, '') FROM qms_forms),
      (SELECT coalesce(max(id)::text, '') || ':' || coalesce(max(updated_at)::text, '') FROM ncr),
      (SELECT coalesce(max(id)::text, '') || ':' || coalesce(max(updated_at)::text, '') FROM complaints),
      (SELECT coalesce(max(id)::text, '') || ':' || coalesce(max(updated_at)::text, '') FROM capa),
      (SELECT coalesce(max(id)::text, '') || ':' || coalesce(max(updated_at)::text, '') FROM eight_d),
      (SELECT coalesce(max(id)::text, '') || ':' || coalesce(max(updated_at)::text, '') FROM document_change_requests),
      (SELECT coalesce(max(id)::text, '') || ':' || coalesce(max(updated_at)::text, '') FROM risk_assessments),
      (SELECT coalesce(max(id)::text, '') || ':' || coalesce(max(id)::text, '') FROM audits),
      (SELECT coalesce(max(id)::text, '') FROM audit_items),
      (SELECT coalesce(max(id)::text, '') FROM equipment),
      (SELECT coalesce(max(id)::text, '') || ':' || coalesce(max(updated_at)::text, '') FROM training_courses),
      (SELECT coalesce(max(id)::text, '') || ':' || coalesce(max(updated_at)::text, '') FROM change_requests)
    ) AS stamp
  `);
  return String(result.rows[0]?.stamp ?? "");
}

/** True when a read would still file, relink, release, or delete a draft. */
async function listingsNeedRepair(db: Db): Promise<boolean> {
  const cutoff = new Date(Date.now() - DRAFT_MAX_AGE_MS);
  const result = await db.execute<{ needed: boolean }>(sql`
    SELECT (
      EXISTS (SELECT 1 FROM iso_quality_forms WHERE updated_at IS NULL AND created_at < ${cutoff})
      OR EXISTS (SELECT 1 FROM validation_reports WHERE updated_at IS NULL AND created_at < ${cutoff})
      OR EXISTS (
        SELECT 1 FROM form_filings f
        LEFT JOIN document_folders d ON d.id = f.folder_node_id
        WHERE f.folder_node_id IS NOT NULL AND d.id IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM form_filings f
        JOIN document_folders d ON d.id = f.folder_node_id
        WHERE d.pdf_path IS NULL
          AND d.document_id IS NULL
          AND coalesce(d.linked_path, '') <> ''
          AND d.linked_path !~ ('/' || f.record_id::text || '$')
          AND NOT EXISTS (SELECT 1 FROM document_folders child WHERE child.parent_id = d.id)
      )
      OR EXISTS (
        SELECT 1 FROM validation_reports vr
        WHERE vr.updated_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM form_filings f WHERE f.record_id = vr.id AND f.form_key LIKE 'frm-val-%')
          AND EXISTS (
            SELECT 1 FROM audit_trail at
            WHERE at.entity_type = 'DocumentFolder'
              AND at.changes->>'event' IN ('orphan_removed', 'filed')
              AND at.changes->>'linkedPath' = '/validation-reports/' || vr.id::text
          )
      )
      OR EXISTS (
        SELECT 1 FROM iso_quality_forms i
        WHERE i.updated_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM form_filings f WHERE f.record_id = i.id)
          AND EXISTS (
            SELECT 1 FROM audit_trail at
            WHERE at.entity_type = 'DocumentFolder'
              AND at.changes->>'event' IN ('orphan_removed', 'filed')
              AND at.changes->>'linkedPath' = '/iso-forms/record/' || i.id::text
          )
      )
      OR EXISTS (
        SELECT 1 FROM qms_forms q
        WHERE q.updated_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM form_filings f WHERE f.record_id = q.id)
          AND EXISTS (
            SELECT 1 FROM audit_trail at
            WHERE at.entity_type = 'DocumentFolder'
              AND at.changes->>'event' IN ('orphan_removed', 'filed')
              AND at.changes->>'linkedPath' ~ ('/qms-forms/[^/]+/' || q.id::text || '$')
          )
      )
      OR EXISTS (
        SELECT 1 FROM iso_quality_forms i
        JOIN form_filings f ON f.record_id = i.id AND f.folder_node_id IS NOT NULL
        WHERE i.updated_at IS NULL
          AND f.form_key = CASE i.form_type
            WHEN 'process_change' THEN 'frm-pcr-001'
            WHEN 'engineering_change' THEN 'frm-ecr-001'
            WHEN 'drawing_change' THEN 'frm-dwg-001'
            WHEN 'document_change' THEN 'frm-doc-001'
            WHEN 'ncr_report' THEN 'frm-ncr-001'
            ELSE f.form_key
          END
          AND i.form_type IN ('process_change', 'engineering_change', 'drawing_change', 'document_change', 'ncr_report', 'psw', 'quality_alert')
      )
      OR EXISTS (
        SELECT 1 FROM ncr n
        WHERE n.is_deleted = false
          AND (n.updated_at IS NOT NULL OR coalesce(n.record_number, '') <> '')
          AND NOT EXISTS (
            SELECT 1 FROM form_filings f
            WHERE f.record_id = n.id AND f.folder_node_id IS NOT NULL AND f.form_key IN ('ncr', 'supplier-ncr')
          )
      )
      OR EXISTS (
        SELECT 1 FROM complaints c
        WHERE (c.updated_at IS NOT NULL OR coalesce(c.record_number, '') <> '')
          AND NOT EXISTS (
            SELECT 1 FROM form_filings f
            WHERE f.record_id = c.id AND f.folder_node_id IS NOT NULL AND f.form_key = 'complaint'
          )
      )
      OR EXISTS (
        SELECT 1 FROM capa c
        WHERE (c.updated_at IS NOT NULL OR coalesce(c.record_number, '') <> '')
          AND NOT EXISTS (SELECT 1 FROM form_filings f WHERE f.record_id = c.id AND f.folder_node_id IS NOT NULL AND f.form_key = 'capa')
      )
      OR EXISTS (
        SELECT 1 FROM eight_d e
        WHERE (e.updated_at IS NOT NULL OR coalesce(e.record_number, '') <> '')
          AND NOT EXISTS (SELECT 1 FROM form_filings f WHERE f.record_id = e.id AND f.folder_node_id IS NOT NULL AND f.form_key = '8d')
      )
      OR EXISTS (
        SELECT 1 FROM document_change_requests d
        WHERE (d.updated_at IS NOT NULL OR coalesce(d.form_no, '') <> '')
          AND NOT EXISTS (SELECT 1 FROM form_filings f WHERE f.record_id = d.id AND f.folder_node_id IS NOT NULL AND f.form_key = 'dcr')
      )
      OR EXISTS (
        SELECT 1 FROM risk_assessments r
        WHERE (r.updated_at IS NOT NULL OR coalesce(r.record_number, '') <> '')
          AND NOT EXISTS (SELECT 1 FROM form_filings f WHERE f.record_id = r.id AND f.folder_node_id IS NOT NULL AND f.form_key = 'risk')
      )
      OR EXISTS (
        SELECT 1 FROM change_requests c
        WHERE (c.updated_at IS NOT NULL OR coalesce(c.record_number, '') <> '')
          AND NOT EXISTS (SELECT 1 FROM form_filings f WHERE f.record_id = c.id AND f.folder_node_id IS NOT NULL AND f.form_key IN ('ecr', 'eco'))
      )
      OR EXISTS (
        SELECT 1 FROM training_courses t
        WHERE t.updated_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM form_filings f WHERE f.record_id = t.id AND f.folder_node_id IS NOT NULL AND f.form_key = 'training-record')
      )
      OR EXISTS (
        SELECT 1 FROM equipment e
        WHERE (coalesce(e.location, '') <> '' OR coalesce(e.serial_number, '') <> '' OR coalesce(e.type, '') <> '')
          AND NOT EXISTS (SELECT 1 FROM form_filings f WHERE f.record_id = e.id AND f.folder_node_id IS NOT NULL AND f.form_key IN ('cal-register', 'cal-record', 'frm-msa-001'))
      )
      OR EXISTS (
        SELECT 1 FROM audits a
        WHERE (
          coalesce(a.record_number, '') <> ''
          OR coalesce(a.status, 'scheduled') <> 'scheduled'
          OR EXISTS (SELECT 1 FROM audit_items item WHERE item.audit_id = a.id)
        )
          AND NOT EXISTS (SELECT 1 FROM form_filings f WHERE f.record_id = a.id AND f.folder_node_id IS NOT NULL AND f.form_key IN ('audit-plan', 'audit-report'))
      )
    ) AS needed
  `);
  return result.rows[0]?.needed === true;
}

async function rememberStamp(db: Db, stamp: string): Promise<void> {
  const [row] = await db.select({ id: company.id, profile: company.profile }).from(company).limit(1);
  if (!row || row.profile?.savedFormListingsStamp === stamp) return;
  await db.update(company).set({ profile: { ...(row.profile ?? {}), savedFormListingsStamp: stamp } }).where(eq(company.id, row.id));
}

/**
 * True when this read can skip filing and relinking.
 * A changed fingerprint still skips the write when nothing is actually missing.
 */
export async function skipSavedListingRepair(db: Db): Promise<boolean> {
  const stamp = await oneStamp(db);
  const [row] = await db.select({ profile: company.profile }).from(company).limit(1);
  if (row?.profile?.savedFormListingsStamp === stamp) return true;
  if (await listingsNeedRepair(db)) return false;
  await rememberStamp(db, stamp);
  return true;
}

/** Call after a repair so the next read of the same rows does not rebuild. */
export async function rememberSavedListingStamp(db: Db): Promise<void> {
  await rememberStamp(db, await oneStamp(db));
}
