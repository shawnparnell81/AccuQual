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
          AND NOT EXISTS (
            SELECT 1 FROM form_filings f
            WHERE f.record_id = vr.id
              AND f.folder_node_id IS NOT NULL
              AND f.form_key = CASE coalesce(vr.data->>'formType', '')
                WHEN 'fuel_pump' THEN 'frm-val-007'
                WHEN 'air_strut' THEN 'frm-val-010'
                WHEN 'air_spring' THEN 'frm-val-011'
                WHEN 'fuel_injector' THEN 'frm-val-008'
                WHEN 'brake_wear' THEN 'frm-val-009'
                WHEN 'shock' THEN 'frm-val-002'
                WHEN 'air_compressor' THEN 'frm-val-003'
                WHEN 'electric_lift' THEN 'frm-val-004'
                WHEN 'gas_lift' THEN 'frm-val-005'
                WHEN 'coil_spring' THEN 'frm-val-006'
                ELSE 'frm-val-001'
              END
          )
      )
      OR EXISTS (
        SELECT 1 FROM iso_quality_forms i
        WHERE i.updated_at IS NOT NULL
          AND CASE i.form_type
            WHEN 'psw' THEN 'frm-psw-001'
            WHEN 'turtle_diagram' THEN 'frm-prc-001'
            WHEN 'quality_alert' THEN 'frm-qa-001'
            WHEN 'customer_scorecard' THEN 'frm-cus-001'
            WHEN 'failure_effectiveness' THEN 'frm-fae-001'
            WHEN 'audit_summary' THEN 'frm-gen-002'
            WHEN 'visitor_log' THEN 'lst-vis-001'
            WHEN 'monthly_engineering' THEN 'rpt-eng-001'
            WHEN 'salt_spray' THEN 'frm-trp-002'
            WHEN 'volume_water' THEN 'frm-tst-001'
            WHEN 'volume_heptane' THEN 'frm-tst-002'
            WHEN 'prototype_strut' THEN 'frm-trp-001'
            WHEN 'dev_csa' THEN 'frm-dev-001'
            WHEN 'dev_fuel_pump' THEN 'frm-dev-002'
            WHEN 'dev_gas_lift' THEN 'frm-dev-003'
            WHEN 'dev_coil' THEN 'frm-dev-004'
            WHEN 'dev_air_spring' THEN 'frm-dev-005'
            WHEN 'dev_air_strut' THEN 'frm-dev-006'
            WHEN 'dev_brake_wear' THEN 'frm-dev-007'
            WHEN 'dev_electronic_shock' THEN 'frm-dev-008'
            WHEN 'dev_air_compressor' THEN 'frm-dev-009'
            WHEN 'dev_fuel_injector' THEN 'frm-dev-010'
            WHEN 'dev_electric_lift' THEN 'frm-dev-011'
            WHEN 'dev_electronic_csa' THEN 'frm-dev-012'
            WHEN 'dev_shock' THEN 'frm-dev-013'
            WHEN 'engineering_change' THEN 'frm-ecr-001'
            WHEN 'drawing_change' THEN 'frm-dwg-001'
            WHEN 'process_change' THEN 'frm-pcr-001'
            WHEN 'document_change' THEN 'frm-doc-001'
            WHEN 'scar_request' THEN 'frm-car-001'
            WHEN 'ncr_report' THEN 'frm-ncr-001'
            WHEN 'quarantine_notice' THEN 'frm-ncr-002'
            WHEN 'concession' THEN 'frm-ncr-003'
            WHEN 'internal_audit' THEN 'frm-gen-001'
            WHEN 'competency_training' THEN 'frm-trn-001'
            WHEN 'cross_training' THEN 'frm-trn-002'
            ELSE NULL
          END IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM form_filings f
            WHERE f.record_id = i.id
              AND f.folder_node_id IS NOT NULL
              AND f.form_key = CASE i.form_type
                WHEN 'psw' THEN 'frm-psw-001'
                WHEN 'turtle_diagram' THEN 'frm-prc-001'
                WHEN 'quality_alert' THEN 'frm-qa-001'
                WHEN 'customer_scorecard' THEN 'frm-cus-001'
                WHEN 'failure_effectiveness' THEN 'frm-fae-001'
                WHEN 'audit_summary' THEN 'frm-gen-002'
                WHEN 'visitor_log' THEN 'lst-vis-001'
                WHEN 'monthly_engineering' THEN 'rpt-eng-001'
                WHEN 'salt_spray' THEN 'frm-trp-002'
                WHEN 'volume_water' THEN 'frm-tst-001'
                WHEN 'volume_heptane' THEN 'frm-tst-002'
                WHEN 'prototype_strut' THEN 'frm-trp-001'
                WHEN 'dev_csa' THEN 'frm-dev-001'
                WHEN 'dev_fuel_pump' THEN 'frm-dev-002'
                WHEN 'dev_gas_lift' THEN 'frm-dev-003'
                WHEN 'dev_coil' THEN 'frm-dev-004'
                WHEN 'dev_air_spring' THEN 'frm-dev-005'
                WHEN 'dev_air_strut' THEN 'frm-dev-006'
                WHEN 'dev_brake_wear' THEN 'frm-dev-007'
                WHEN 'dev_electronic_shock' THEN 'frm-dev-008'
                WHEN 'dev_air_compressor' THEN 'frm-dev-009'
                WHEN 'dev_fuel_injector' THEN 'frm-dev-010'
                WHEN 'dev_electric_lift' THEN 'frm-dev-011'
                WHEN 'dev_electronic_csa' THEN 'frm-dev-012'
                WHEN 'dev_shock' THEN 'frm-dev-013'
                WHEN 'engineering_change' THEN 'frm-ecr-001'
                WHEN 'drawing_change' THEN 'frm-dwg-001'
                WHEN 'process_change' THEN 'frm-pcr-001'
                WHEN 'document_change' THEN 'frm-doc-001'
                WHEN 'scar_request' THEN 'frm-car-001'
                WHEN 'ncr_report' THEN 'frm-ncr-001'
                WHEN 'quarantine_notice' THEN 'frm-ncr-002'
                WHEN 'concession' THEN 'frm-ncr-003'
                WHEN 'internal_audit' THEN 'frm-gen-001'
                WHEN 'competency_training' THEN 'frm-trn-001'
                WHEN 'cross_training' THEN 'frm-trn-002'
                ELSE NULL
              END
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
      OR EXISTS (
        SELECT 1 FROM qms_forms q
        WHERE q.updated_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM form_filings f WHERE f.record_id = q.id AND f.folder_node_id IS NOT NULL AND f.form_key = q.form_type)
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
