import { sql } from "drizzle-orm";
import type { Request } from "express";
import type { ResourceKey } from "../../middleware/departmentAccess.js";
import { getUserAccessLevel } from "../../middleware/departmentAccess.js";
import { assertRecordOnAllowedSite } from "../sites/siteAccess.js";
import { isFullAccessRole } from "../roles/roleAccess.js";
import { AppError } from "../../utils/appError.js";
import type { Db } from "../../lib/requestDb.js";

/**
 * Attachment entityType (the string the record pages send) -> the module
 * that already gates that record, and the table the parent row lives in.
 * `site` means the row carries a plant, checked the same way NCR, CAPA,
 * and audits are. 8D and FMEA (risk) have no plant column; department
 * access is the check those modules already use.
 */
const PARENTS: Record<string, { resource: ResourceKey; table: string; site: boolean }> = {
  ncr: { resource: "ncr", table: "ncr", site: true },
  capa: { resource: "capa", table: "capa", site: true },
  eight_d: { resource: "eight_d", table: "eight_d", site: false },
  risk: { resource: "risk", table: "risk_assessments", site: false },
  audit: { resource: "audit", table: "audits", site: true },
  suppliers: { resource: "suppliers", table: "suppliers", site: false },
  scar_forms: { resource: "scar", table: "scar_forms", site: false },
  rma_log: { resource: "rma_log", table: "rma_log", site: false },
  calibration: { resource: "calibration", table: "equipment", site: false },
  document_change_requests: { resource: "documents", table: "document_change_requests", site: false },
  feasibility: { resource: "feasibility", table: "feasibility_reviews", site: false },
  quarantine: { resource: "quarantine", table: "quarantine_records", site: false },
  change: { resource: "change", table: "change_requests", site: false },
  warranty_claim: { resource: "warranty", table: "warranty_claims", site: false },
  complaint: { resource: "complaints", table: "complaints", site: false },
  quality_inspection_reports: { resource: "quality_inspection", table: "quality_inspection_reports", site: false },
  erp_po: { resource: "erp", table: "erp_purchase_orders", site: false },
  erp_requisition: { resource: "purchase_requisitions", table: "erp_purchase_requisitions", site: false },
  crar: { resource: "crar", table: "crar", site: false },
  work_orders: { resource: "work_orders", table: "work_orders", site: false },
  ppap: { resource: "ppap", table: "ppap_packages", site: false },
  rma: { resource: "rma", table: "rma", site: false },
  training: { resource: "training", table: "training_courses", site: false },
  CustomerCommunication: { resource: "customer_communications", table: "customer_communications", site: false },
};

function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unexpected table name "${name}"`);
  return `"${name}"`;
}

async function loadParent(db: Db, table: string, id: number, site: boolean): Promise<{ id: number; siteId: number | null } | null> {
  const siteSql = site ? "site_id" : "NULL::int";
  const found = await db.execute(sql.raw(`SELECT id, ${siteSql} AS site_id FROM ${ident(table)} WHERE id = ${id} LIMIT 1`));
  const row = found.rows?.[0] as { id?: number; site_id?: number | null } | undefined;
  if (!row || row.id == null) return null;
  return { id: Number(row.id), siteId: row.site_id == null ? null : Number(row.site_id) };
}

/**
 * Listing, downloading, uploading, and deleting all go through this.
 * A supplier login never reaches these files — portal files are the
 * supplier-portal routes, which stay limited to that supplier's own rows.
 * The shared general-uploads bin has no parent record; any internal
 * sign-in may use it.
 */
export async function assertAttachmentAudience(req: Request, entityType: string | null, entityId: number | null): Promise<void> {
  if (req.user?.roleName === "supplier") {
    throw AppError.forbidden("Supplier logins can only open their own portal files.");
  }
  if (!entityType && (entityId == null || Number.isNaN(entityId))) return;
  if (!entityType || entityId == null || !Number.isInteger(entityId) || entityId <= 0) {
    throw AppError.badRequest("entityType and entityId must be provided together");
  }
  const spec = PARENTS[entityType];
  if (!spec) throw AppError.badRequest("That record type can't have attachments.");
  if (!req.user || !req.db) throw AppError.forbidden("No access to that file");
  if (!isFullAccessRole(req.user.roleName)) {
    const level = await getUserAccessLevel(req.db, req.user, spec.resource);
    if (level === "none") throw AppError.forbidden(`No access to '${spec.resource}' for your department`);
  }
  const parent = await loadParent(req.db, spec.table, entityId, spec.site);
  if (!parent) throw AppError.notFound("Attachment");
  if (spec.site) assertRecordOnAllowedSite(parent.siteId, req.allowedSiteIds, "Attachment");
}
