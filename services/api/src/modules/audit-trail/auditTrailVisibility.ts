import type { Db } from "../../lib/requestDb.js";
import { getUserAccessLevel, type ResourceKey } from "../../middleware/departmentAccess.js";
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
  FeasibilityReview: "feasibility",
  FeasibilitySettings: "feasibility",
  InventoryAlert: "inventory",
  InventoryItem: "inventory",
  InventorySettings: "inventory",
  NCR: "ncr",
  "Validation Report": "documents",
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
export const ACCOUNT_ENTITY_TYPES = new Set(["Company", "User", "DepartmentPermission", "PermissionRole", "UserPermissionRole"]);

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

/** One record's history. The caller must already be allowed to open that record. */
export async function assertCanReadEntityHistory(db: Db, user: Viewer, entityType: string, entityId: number): Promise<void> {
  if (isFullAccessRole(user.roleName)) return;
  if (entityType === "User" && entityId === user.id) return;
  if (ACCOUNT_ENTITY_TYPES.has(entityType)) {
    throw AppError.forbidden("Sign-in and account history is limited to an Owner or Administrator.");
  }
  const resource = ENTITY_TYPE_TO_RESOURCE[entityType];
  if (!resource) throw AppError.badRequest(`Unknown record type "${entityType}"`);
  const level = await getUserAccessLevel(db, user, resource);
  if (level === "none") throw AppError.forbidden(`No access to '${entityType}' history for your department`);
}
