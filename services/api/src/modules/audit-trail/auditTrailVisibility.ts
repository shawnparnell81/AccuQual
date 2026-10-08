import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { getUserAccessLevel, type ResourceKey } from "../../middleware/departmentAccess.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { capa } from "../../drizzle/schema/capa.js";
import { audits, auditItems } from "../../drizzle/schema/audits.js";
import { auditTrail } from "../../drizzle/schema/auditTrail.js";
import { assertRecordOnAllowedSite } from "../sites/siteAccess.js";
import { isFullAccessRole } from "../roles/roleAccess.js";
import { AppError } from "../../utils/appError.js";

/**
 * entityType (exactly as passed to recordAuditTrail) -> the ResourceKey that
 * already gates that entity's own module. A person who can open the record
 * can read its history. Anything not on this map is not a record history.
 */
export const ENTITY_TYPE_TO_RESOURCE: Record<string, ResourceKey> = {
  "8D Report": "eight_d",
  WorkflowVersion: "workflow",
  WorkflowRun: "workflow",
  ManagementReviewVersion: "management_review",
  ContextVersion: "context_of_org",
  Audit: "audit",
  "Audit Finding": "audit",
  CAPA: "capa",
  "Change request": "change",
  Complaint: "complaints",
  Crar: "crar",
  Customer: "customers",
  CustomerCommunication: "customer_communications",
  CustomerScorecard: "customers",
  "Discrepancy investigation": "di",
  Document: "documents",
  DocumentChangeRequest: "documents",
  DocumentFolder: "documents",
  Equipment: "calibration",
  Quarantine: "quarantine",
  WorkerProfile: "worker_profile",
  TrainingCourse: "training",
  TrainingSession: "training",
  TrainingCompetency: "training",
  ErpConnectorPreset: "erp",
  ErpReceivingLineItem: "erp",
  ErpSyncError: "erp",
  ErpSyncSettings: "erp",
  FaiRecord: "fai",
  CsaFai: "fai",
  FuelPumpFai: "fai",
  FaiInspectionPlan: "fai",
  FaiSourceApproval: "fai",
  FaiAnnualPull: "fai",
  FeasibilityReview: "feasibility",
  FeasibilitySettings: "feasibility",
  InventoryAlert: "inventory",
  InventoryItem: "inventory",
  InventorySettings: "inventory",
  NCR: "ncr",
  "ISO form": "documents",
  "Validation Report": "documents",
  BuiltForm: "form_builder",
  "PPAP package": "ppap",
  PurchaseOrder: "erp",
  PurchaseRequisition: "purchase_requisitions",
  QmsForm: "qms_forms",
  QualityInspectionReport: "quality_inspection",
  ReceivingDocument: "erp",
  ReceivingSettings: "erp",
  RiskAssessment: "risk",
  RiskMitigation: "risk",
  Rma: "rma",
  RmaLog: "rma_log",
  SalesAccount: "sales",
  SalesContract: "sales",
  SalesQuote: "sales",
  ScarForm: "scar",
  Supplier: "suppliers",
  Supplier8dResponse: "supplier_portal",
  SupplierCorrectiveAction: "supplier_portal",
  SupplierDocument: "supplier_portal",
  SupplierMessage: "supplier_portal",
  SupplierOnboardingDocument: "supplier_portal",
  SupplierPpapSubmission: "supplier_portal",
  SupplierRiskSettings: "suppliers",
  SupplierNcrRequest: "supplier_portal",
  SupplierRmaRequest: "supplier_portal",
  SupplierScorecard: "suppliers",
  TrainingAssignment: "training",
  WarrantyClaim: "warranty",
  warranty_claim: "warranty",
  WorkOrder: "work_orders",
  WorkflowDefinition: "workflow",
  audit_finding: "audit",
};

/** Account, sign-in, and permission history. Not a record another department opens. */
export const ACCOUNT_ENTITY_TYPES = new Set(["Company", "User", "DepartmentPermission", "PermissionRole", "UserPermissionRole", "SignIn"]);

type Viewer = { id: number; roleName: string | null; department: string | null };

/** "all" is an owner or administrator. Everyone else gets the record types their access already allows. */
export async function visibleEntityTypes(db: Db, user: Viewer): Promise<Set<string> | "all"> {
  if (isFullAccessRole(user.roleName)) return "all";
  const resources = [...new Set(Object.values(ENTITY_TYPE_TO_RESOURCE))];
  const allowed = new Set<ResourceKey>();
  await Promise.all(
    resources.map(async (resource) => {
      const level = await getUserAccessLevel(db, user, resource);
      if (level !== "none") allowed.add(resource);
    }),
  );
  const types = new Set<string>();
  for (const [entityType, resource] of Object.entries(ENTITY_TYPE_TO_RESOURCE)) {
    if (allowed.has(resource)) types.add(entityType);
  }
  return types;
}

/** Company activity list. Another person's sign-in and account rows stay with an owner or administrator. */
export function canSeeCompanyAuditRow(visible: Set<string> | "all", row: { entityType: string; entityId: number }, userId: number): boolean {
  if (visible === "all") return true;
  if (row.entityType === "User") return row.entityId === userId;
  if (ACCOUNT_ENTITY_TYPES.has(row.entityType)) return false;
  return visible.has(row.entityType);
}

/**
 * Record types whose row carries a plant, same tables attachments already
 * check. An audit finding lives on audit_items; the plant is the parent audit.
 */
const SITE_COLUMN: Record<string, "ncr" | "capa" | "audits"> = {
  NCR: "ncr",
  CAPA: "capa",
  Audit: "audits",
};

function isAuditFinding(entityType: string): boolean {
  return entityType === "Audit Finding" || entityType === "audit_finding";
}

function isSiteBearing(entityType: string): boolean {
  return SITE_COLUMN[entityType] != null || isAuditFinding(entityType);
}

/** id -> plant. Missing ids are absent from the map (the row is gone). */
async function loadSiteIds(db: Db, entityType: string, ids: number[]): Promise<Map<number, number | null>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  if (isAuditFinding(entityType)) {
    const rows = await db
      .select({ id: auditItems.id, siteId: audits.siteId })
      .from(auditItems)
      .leftJoin(audits, eq(audits.id, auditItems.auditId))
      .where(inArray(auditItems.id, unique));
    return new Map(rows.map((row) => [row.id, row.siteId]));
  }
  const table = SITE_COLUMN[entityType];
  if (table === "ncr") {
    const rows = await db.select({ id: ncr.id, siteId: ncr.siteId }).from(ncr).where(inArray(ncr.id, unique));
    return new Map(rows.map((row) => [row.id, row.siteId]));
  }
  if (table === "capa") {
    const rows = await db.select({ id: capa.id, siteId: capa.siteId }).from(capa).where(inArray(capa.id, unique));
    return new Map(rows.map((row) => [row.id, row.siteId]));
  }
  if (table === "audits") {
    const rows = await db.select({ id: audits.id, siteId: audits.siteId }).from(audits).where(inArray(audits.id, unique));
    return new Map(rows.map((row) => [row.id, row.siteId]));
  }
  return new Map();
}

/** Plant stamped on a delete snapshot once the record itself is gone. */
function snapshotSiteId(changes: unknown): number | null | undefined {
  if (!changes || typeof changes !== "object") return undefined;
  const snapshot = (changes as { snapshot?: unknown }).snapshot;
  if (!snapshot || typeof snapshot !== "object" || !("siteId" in snapshot)) return undefined;
  const siteId = (snapshot as { siteId?: unknown }).siteId;
  if (siteId == null) return null;
  const id = Number(siteId);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

function onCallerPlant(siteId: number | null | undefined, allowedSiteIds: number[]): boolean {
  return siteId != null && allowedSiteIds.includes(siteId);
}

/** Drop company-list rows for a plant this person cannot open. Owners and administrators see every plant. A deleted record keeps the plant from its snapshot. */
export async function filterCompanyAuditBySite<T extends { entityType: string; entityId: number; changes?: unknown }>(
  db: Db,
  rows: T[],
  user: Viewer,
  allowedSiteIds: number[] | undefined,
): Promise<T[]> {
  if (isFullAccessRole(user.roleName) || !allowedSiteIds) return rows;
  const idsByType = new Map<string, number[]>();
  for (const row of rows) {
    if (!isSiteBearing(row.entityType)) continue;
    const list = idsByType.get(row.entityType) ?? [];
    list.push(row.entityId);
    idsByType.set(row.entityType, list);
  }
  const sitesByType = new Map<string, Map<number, number | null>>();
  await Promise.all(
    [...idsByType.entries()].map(async ([entityType, ids]) => {
      sitesByType.set(entityType, await loadSiteIds(db, entityType, ids));
    }),
  );
  return rows.filter((row) => {
    if (!isSiteBearing(row.entityType)) return true;
    const known = sitesByType.get(row.entityType);
    if (known?.has(row.entityId)) return onCallerPlant(known.get(row.entityId), allowedSiteIds);
    const fromSnapshot = snapshotSiteId(row.changes);
    if (fromSnapshot === undefined) return true;
    return onCallerPlant(fromSnapshot, allowedSiteIds);
  });
}

async function assertHistoryOnAllowedSite(db: Db, entityType: string, entityId: number, allowedSiteIds: number[] | undefined): Promise<void> {
  if (!allowedSiteIds || !isSiteBearing(entityType)) return;
  const sites = await loadSiteIds(db, entityType, [entityId]);
  if (sites.has(entityId)) {
    assertRecordOnAllowedSite(sites.get(entityId), allowedSiteIds, entityType);
    return;
  }
  const [latest] = await db
    .select({ changes: auditTrail.changes })
    .from(auditTrail)
    .where(and(eq(auditTrail.entityType, entityType), eq(auditTrail.entityId, entityId)))
    .orderBy(desc(auditTrail.id))
    .limit(1);
  const fromSnapshot = snapshotSiteId(latest?.changes);
  if (fromSnapshot === undefined) return;
  assertRecordOnAllowedSite(fromSnapshot, allowedSiteIds, entityType);
}

/** One record's history. The caller must already be allowed to open that record, including its plant. */
export async function assertCanReadEntityHistory(
  db: Db,
  user: Viewer,
  entityType: string,
  entityId: number,
  allowedSiteIds?: number[],
): Promise<void> {
  if (isFullAccessRole(user.roleName)) return;
  if (entityType === "User" && entityId === user.id) return;
  if (ACCOUNT_ENTITY_TYPES.has(entityType)) {
    throw AppError.forbidden("Sign-in and account history is limited to an Owner or Administrator.");
  }
  const resource = ENTITY_TYPE_TO_RESOURCE[entityType];
  if (!resource) throw AppError.badRequest(`Unknown record type "${entityType}"`);
  const level = await getUserAccessLevel(db, user, resource);
  if (level === "none") throw AppError.forbidden(`No access to '${entityType}' history for your department`);
  await assertHistoryOnAllowedSite(db, entityType, entityId, allowedSiteIds);
}
