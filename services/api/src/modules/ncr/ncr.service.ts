import { and, eq } from "drizzle-orm";
import { ncr } from "../../drizzle/schema/ncr.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";
import type { TenantDb } from "../../lib/tenantScope.js";

async function patchNcr(
  db: TenantDb,
  tenantId: number,
  id: number,
  patch: Partial<typeof ncr.$inferInsert>,
  action: string,
  performedBy?: number
) {
  const [updated] = await db
    .update(ncr)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(ncr.id, id), eq(ncr.tenantId, tenantId)))
    .returning();
  if (!updated) throw AppError.notFound("NCR");
  await recordAuditTrail(db, { tenantId, entityType: "ncr", entityId: id, action: "status_change", changes: { action, patch }, performedBy });
  await publishEvent(WORKFLOW_STREAM, { tenantId, module: "ncr", event: action, entityId: id });
  return updated;
}

export const assign = (db: TenantDb, tenantId: number, id: number, assignedTo: number, performedBy?: number) =>
  patchNcr(db, tenantId, id, { assignedTo }, "assigned", performedBy);

export const setContainment = (db: TenantDb, tenantId: number, id: number, containment: string, performedBy?: number) =>
  patchNcr(db, tenantId, id, { containment, status: "contained" }, "containment", performedBy);

export const setRootCause = (db: TenantDb, tenantId: number, id: number, rootCause: string, performedBy?: number) =>
  patchNcr(db, tenantId, id, { rootCause, status: "investigating" }, "root_cause", performedBy);

export const setCorrectiveAction = (db: TenantDb, tenantId: number, id: number, correctiveAction: string, performedBy?: number) =>
  patchNcr(db, tenantId, id, { correctiveAction, status: "corrective_action" }, "corrective_action", performedBy);

export const close = (db: TenantDb, tenantId: number, id: number, performedBy?: number) =>
  patchNcr(db, tenantId, id, { status: "closed", closedAt: new Date() }, "closed", performedBy);
