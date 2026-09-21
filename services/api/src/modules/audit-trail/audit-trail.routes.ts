import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { auditTrail } from "../../drizzle/schema/auditTrail.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { getUserAccessLevel, type ResourceKey } from "../../middleware/departmentAccess.js";
import { withResolvedActors, attachFieldChanges } from "./audit-trail.service.js";
import type { TenantDb } from "../../lib/tenantScope.js";

export const auditTrailRouter = Router();

auditTrailRouter.use(requireAuth, withTenantDb);

/**
 * entityType (exactly as passed to recordAuditTrail's own `entityType`, or
 * crudFactory's `entityName`, across every real call site in this app) ->
 * the ResourceKey that already gates that entity's own module. Closes
 * Full-System Audit finding H1: this endpoint had no RBAC at all — any
 * authenticated tenant user could read any other department's full
 * change/decision history just by knowing or guessing an entityId (tenant
 * scoping itself was already correct; this was an intra-tenant
 * information-disclosure gap, not a cross-tenant one).
 *
 * Deliberately does NOT cover every entityType ever recorded — two real
 * categories are left out on purpose, not missed:
 *   1. Types whose own module has no department gate at all today (Digital
 *      Twin/IotDevice, AI usage records, Attachments — polymorphic, can't
 *      be attributed to one department reliably — Report exports/
 *      schedules, Form Templates, SCAR Forms): gating their audit history
 *      more strictly than the records themselves would be a new
 *      restriction this fix isn't meant to introduce. Training and QMS
 *      Forms used to belong on this list too (Full-System Audit findings
 *      C2/C3), but both later gained a real requireDepartmentAccess gate
 *      on their own routes — leaving their entityTypes off this map after
 *      that would have re-opened exactly the intra-tenant disclosure gap
 *      this fix exists to close, so TrainingAssignment/QmsForm are mapped
 *      below instead. SCAR Forms is still genuinely ungated at the route
 *      level; revisit it here if that ever changes too.
 *   2. Genuinely system/permission-level types (Tenant, User, department
 *      and role permission grants) — no single business department owns
 *      these, so they require admin/platform_admin outright instead of a
 *      ResourceKey lookup.
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

/** No business department owns these — admin/platform_admin only, not a ResourceKey lookup. */
const ADMIN_ONLY_ENTITY_TYPES = new Set(["Tenant", "User", "DepartmentPermission", "PermissionRole", "UserPermissionRole"]);

/** History for a single entity, e.g. GET /audit-trail/ncr/42 */
auditTrailRouter.get(
  "/:entityType/:entityId",
  asyncHandler(async (req, res) => {
    const role = req.user?.roleName;
    const isAdmin = role === "admin" || role === "platform_admin";
    const entityType = req.params.entityType!;

    if (!isAdmin) {
      if (ADMIN_ONLY_ENTITY_TYPES.has(entityType)) {
        throw AppError.forbidden(`No access to '${entityType}' history — admin only`);
      }
      const resourceKey = ENTITY_TYPE_TO_RESOURCE[entityType];
      if (resourceKey) {
        const level = await getUserAccessLevel(req.db! as TenantDb, req.tenantId!, req.user!, resourceKey);
        if (level === "none") throw AppError.forbidden(`No access to '${entityType}' history for your department`);
      }
      // No map entry at all: this entityType's own module has no
      // department gate today either (see the map's own comment) — read
      // access here matches that same already-open reality, not a gap.
    }

    const rows = await req
      .db!.select()
      .from(auditTrail)
      .where(and(eq(auditTrail.entityId, Number(req.params.entityId)), eq(auditTrail.tenantId, req.tenantId!)));
    const filtered = rows.filter((r) => r.entityType === entityType);
    const withActors = await withResolvedActors(req.db! as TenantDb, filtered);
    res.json(await attachFieldChanges(req.db! as TenantDb, req.tenantId!, withActors));
  })
);
