import { Router, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { getUserAccessLevel, type ResourceKey } from "../../middleware/departmentAccess.js";
import { isFullAccessRole } from "../roles/roleAccess.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { editActionFrom, recordEditSession } from "./formEditAudit.js";

/**
 * Edit, Save and Cancel for record types that have no begin-edit route of their own.
 * Same audit lines and the same department edit check as the module's own writes.
 */
const RECORDS: Record<string, { table: string; entityType: string; label: string; resource: ResourceKey }> = {
  suppliers: { table: "suppliers", entityType: "Supplier", label: "Supplier", resource: "suppliers" },
  ppap: { table: "ppap_packages", entityType: "PpapPackage", label: "PPAP", resource: "ppap" },
  warranty: { table: "warranty_claims", entityType: "WarrantyClaim", label: "Warranty claim", resource: "warranty" },
  crar: { table: "crar", entityType: "Crar", label: "CRAR", resource: "crar" },
  rma: { table: "rma", entityType: "Rma", label: "RMA", resource: "rma" },
  "work-orders": { table: "work_orders", entityType: "WorkOrder", label: "Work order", resource: "work_orders" },
  feasibility: { table: "feasibility_reviews", entityType: "FeasibilityReview", label: "Feasibility review", resource: "feasibility" },
  "quality-inspection-reports": { table: "quality_inspection_reports", entityType: "QualityInspectionReport", label: "Quality inspection report", resource: "quality_inspection" },
  workers: { table: "users", entityType: "WorkerProfile", label: "Worker profile", resource: "worker_profile" },
  "fai-records": { table: "fai_records", entityType: "FaiRecord", label: "FAI record", resource: "fai" },
  "fai-plans": { table: "fai_inspection_plans", entityType: "FaiPlan", label: "FAI plan", resource: "fai" },
  documents: { table: "documents", entityType: "Document", label: "Document", resource: "documents" },
};

export const recordEditsRouter = Router();
recordEditsRouter.use(requireAuth, withDb);

recordEditsRouter.post(
  "/:kind/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const spec = RECORDS[String(req.params.kind)];
    if (!spec) throw AppError.notFound("Record type");
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw AppError.badRequest("Record is required");
    const action = editActionFrom(req.body);
    if (!isFullAccessRole(req.user?.roleName)) {
      const level = await getUserAccessLevel(req.db!, req.user!, spec.resource);
      if (level !== "edit") throw AppError.forbidden(`You don't have permission to edit ${spec.label.toLowerCase()} records.`);
    }
    const found = await req.db!.execute(sql`SELECT 1 FROM ${sql.identifier(spec.table)} WHERE id = ${id}`);
    if (!found.rows?.length) throw AppError.notFound(spec.label);
    await recordEditSession(req.db!, { entityType: spec.entityType, label: spec.label, id, userId: req.user?.id, action });
    res.json({ editing: action === "start" });
  }),
);
