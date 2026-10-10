import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { sites } from "../../drizzle/schema/sites.js";
import { getUserAccessLevel, type ResourceKey } from "../../middleware/departmentAccess.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { isSiteAdmin, isRetiredPlant, plantDisplayName } from "./siteAccess.js";
import { roleCanViewAllSites } from "../roles/rolePermissions.js";
import { optionalRows, sqlIdent } from "./optionalSql.js";

const RECORD_SITES = {
  ncr: { table: "ncr", resource: "ncr", audit: "NCR" },
  capa: { table: "capa", resource: "capa", audit: "CAPA" },
  audit: { table: "audits", resource: "audit", audit: "Audit" },
  complaint: { table: "complaints", resource: "complaints", audit: "Complaint" },
  warranty: { table: "warranty_claims", resource: "warranty", audit: "WarrantyClaim" },
  labor_claim: { table: "labor_claims", resource: "labor_claims", audit: "LaborClaim" },
  validation_report: { table: "validation_reports", resource: "documents", audit: "Validation Report" },
  iso_form: { table: "iso_quality_forms", resource: "documents", audit: "ISO form" },
  qms_form: { table: "qms_forms", resource: "qms_forms", audit: "QmsForm" },
  built_fill: { table: "built_form_fills", resource: "documents", audit: "BuiltFormFill" },
} as const;

export type RecordSiteEntity = keyof typeof RECORD_SITES;

const STAMP_TABLES = new Set<string>(Object.values(RECORD_SITES).map((row) => row.table));

export function isRecordSiteEntity(value: string): value is RecordSiteEntity {
  return value in RECORD_SITES;
}

/** New records remember the plant the person is working in. A missing column is ignored until the migration runs. Existing nulls stay null. */
export async function stampRecordSite(db: Db, table: string, id: number, siteId: number | null | undefined): Promise<void> {
  if (!STAMP_TABLES.has(table) || siteId == null || !Number.isInteger(siteId) || siteId < 1 || !Number.isInteger(id)) return;
  await optionalRows(db, sql`UPDATE ${sql.raw(sqlIdent(table))} SET site_id = ${siteId} WHERE id = ${id} AND site_id IS NULL`);
}

async function siteName(db: Db, siteId: number | null): Promise<string> {
  if (siteId == null) return "Unassigned";
  const [site] = await db.select({ name: sites.name, nameSnapshot: sites.nameSnapshot }).from(sites).where(eq(sites.id, siteId));
  return site ? plantDisplayName(site) : "Unassigned";
}

export async function readRecordSite(db: Db, entity: RecordSiteEntity, id: number): Promise<{ siteId: number | null; siteName: string }> {
  const spec = RECORD_SITES[entity];
  const rows = await optionalRows<{ site_id: number | null }>(db, sql`SELECT site_id FROM ${sql.raw(sqlIdent(spec.table))} WHERE id = ${id} LIMIT 1`);
  if (rows == null) return { siteId: null, siteName: "Unassigned" };
  const row = rows[0];
  if (!row) throw AppError.notFound(spec.audit);
  const siteId = row.site_id == null ? null : Number(row.site_id);
  return { siteId, siteName: await siteName(db, siteId) };
}

export async function changeRecordSite(
  db: Db,
  actor: { id: number; roleName: string | null; department: string | null },
  entity: RecordSiteEntity,
  id: number,
  siteId: number,
): Promise<{ siteId: number; siteName: string }> {
  const spec = RECORD_SITES[entity];
  const level = await getUserAccessLevel(db, actor, spec.resource as ResourceKey);
  if (level !== "edit") throw AppError.forbidden("You can view this record, but you can't change its site.");

  const [target] = await db.select().from(sites).where(eq(sites.id, siteId));
  if (!target || isRetiredPlant(target)) throw AppError.badRequest("Choose a plant that is still in use.");

  const viewAll = await roleCanViewAllSites(db, actor.roleName);
  if (!isSiteAdmin(actor.roleName) && !viewAll) {
    const member = await db.execute(sql`SELECT 1 AS ok FROM user_sites WHERE user_id = ${actor.id} AND site_id = ${siteId} LIMIT 1`);
    if ((member.rows ?? []).length === 0) throw AppError.forbidden("You aren't assigned to that plant.");
  }

  const current = await readRecordSite(db, entity, id);
  const rows = await optionalRows<{ id: number }>(
    db,
    sql`UPDATE ${sql.raw(sqlIdent(spec.table))} SET site_id = ${siteId} WHERE id = ${id} RETURNING id`,
  );
  if (rows == null) throw new AppError("Site isn't stored on this record until the database update runs.", 503);
  if (rows.length === 0) throw AppError.notFound(spec.audit);
  const siteNameNext = plantDisplayName(target);
  if (entity === "validation_report") {
    await db.execute(sql`
      UPDATE validation_reports
      SET data = jsonb_set(COALESCE(data, '{}'::jsonb), '{siteName}', to_jsonb(${siteNameNext}::text), true)
      WHERE id = ${id}
    `);
  }
  await recordAuditTrail(db, {
    entityType: spec.audit,
    entityId: id,
    action: "update",
    changes: { siteId, siteName: siteNameNext, previousSiteName: current.siteName },
    performedBy: actor.id,
  });
  return { siteId, siteName: siteNameNext };
}
