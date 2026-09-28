import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { auditTrail } from "../../drizzle/schema/auditTrail.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { getUserAccessLevel, type ResourceKey } from "../../middleware/departmentAccess.js";
import { withResolvedActors, attachFieldChanges } from "./audit-trail.service.js";
import type { Db } from "../../lib/requestDb.js";
import { isFullAccessRole } from "../roles/roleAccess.js";

export const auditTrailRouter = Router();

auditTrailRouter.use(requireAuth, withDb);

/**
 * entityType (exactly as passed to recordAuditTrail's own `entityType`, or
 * crudFactory's `entityName`, across every real call site in this app) ->
 * the ResourceKey that already gates that entity's own module. Closes
 * Full-System Audit finding H1: this endpoint had no RBAC at all — any
 * authenticated company user could read any other department's full
 * change/decision history just by knowing or guessing an entityId (company
 * scoping itself was already correct; this was an intra-company
 * information-disclosure gap, not a one).
 *
 * Only types on this map, or the admin-only set below, can be read.
 * Anything else is rejected, including for an administrator. Training and
 * QMS Forms are mapped because their own routes are department-gated.
 * System types (Company, User, department and role permission grants)
 * have no single business department, so they require admin instead of a
 * ResourceKey lookup.
 */
const ENTITY_TYPE_TO_RESOURCE: Record<string, ResourceKey> = {
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
  warranty_claim: "warranty", // a real inconsistent-casing duplicate found across call sites — mapped defensively, not "fixed" (out of this change's scope)
  WorkOrder: "work_orders",
  WorkflowDefinition: "workflow",
  audit_finding: "audit", // same inconsistent-casing situation as warranty_claim above
};

/** No business department owns these — admin only, not a ResourceKey lookup. */
const ADMIN_ONLY_ENTITY_TYPES = new Set(["Company", "Company", "User", "DepartmentPermission", "PermissionRole", "UserPermissionRole"]);

/** History for a single entity, e.g. GET /audit-trail/ncr/42 */
auditTrailRouter.get(
  "/:entityType/:entityId",
  asyncHandler(async (req, res) => {
    const role = req.user?.roleName;
    const isAdmin = isFullAccessRole(role);
    const entityType = req.params.entityType!;

    if (!ENTITY_TYPE_TO_RESOURCE[entityType] && !ADMIN_ONLY_ENTITY_TYPES.has(entityType)) {
      throw AppError.badRequest(`Unknown record type "${entityType}"`);
    }

    if (!isAdmin) {
      if (ADMIN_ONLY_ENTITY_TYPES.has(entityType)) {
        throw AppError.forbidden(`No access to '${entityType}' history — admin only`);
      }
      const resourceKey = ENTITY_TYPE_TO_RESOURCE[entityType];
      if (resourceKey) {
        const level = await getUserAccessLevel(req.db! as Db, req.user!, resourceKey);
        if (level === "none") throw AppError.forbidden(`No access to '${entityType}' history for your department`);
      }
    }

    const rows = await req
      .db!.select()
      .from(auditTrail)
      .where(and(eq(auditTrail.entityId, Number(req.params.entityId))));
    const filtered = rows.filter((r) => r.entityType === entityType);
    const withActors = await withResolvedActors(req.db! as Db, filtered);
    res.json(await attachFieldChanges(req.db! as Db, withActors));
  })
);
