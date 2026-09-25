import { and, eq } from "drizzle-orm";
import { ncr } from "../../drizzle/schema/ncr.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";
import { syncNcrFormData, ncrIsoDate } from "./ncr.formSync.js";
import type { Db } from "../../lib/requestDb.js";
import { assertRecordOnAllowedSite } from "../sites/siteAccess.js";

/**
 * `expectedFrom`, when given, enforces the sequence the Transitions/Rules
 * Dictionaries called out as missing everywhere in the app — reject the step
 * if the record isn't already in one of the states it's allowed to move
 * from, instead of silently overwriting whatever state it was actually in.
 */
async function patchNcr(
  db: Db,
  id: number,
  patch: Partial<typeof ncr.$inferInsert>,
  action: string,
  performedBy?: number,
  expectedFrom?: string[],
  allowedSiteIds?: number[]
) {
  const [current] = await db.select().from(ncr).where(and(eq(ncr.id, id)));
  if (!current) throw AppError.notFound("NCR");
  assertRecordOnAllowedSite(current.siteId, allowedSiteIds, "NCR");
  if (expectedFrom && !expectedFrom.includes(current.status)) {
    throw AppError.badRequest(`Cannot "${action}" an NCR from status "${current.status}" — must be one of: ${expectedFrom.join(", ")}`);
  }

  const [updated] = await db
    .update(ncr)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(ncr.id, id)))
    .returning();
  if (!updated) throw AppError.notFound("NCR");
  // "NCR" — must match crudFactory's entityName for this table (ncr.controller.ts's
  // baseHandlers) exactly; a casing mismatch here previously made this
  // status-change history invisible on one side or the other of the split,
  // since workflow.controller.ts's MODULE_ENTITY_TYPES filters by exact
  // string match (Postgres text comparison is case-sensitive). See the QA
  // sweep review.
  await recordAuditTrail(db, { entityType: "NCR", entityId: id, action: "status_change", changes: { action, patch }, performedBy });
  await publishEvent(WORKFLOW_STREAM, { module: "ncr", event: action, entityId: id });
  return updated;
}

// Assigning ownership isn't a lifecycle step — allowed from any status.
export const assign = (db: Db, id: number, assignedTo: number, performedBy?: number, allowedSiteIds?: number[]) =>
  patchNcr(db, id, { assignedTo }, "assigned", performedBy, undefined, allowedSiteIds);

// Phase 2 NCR unified-data-model fix: each workflow step also syncs the
// matching field on the official document (see ncr.formSync.ts) — the same
// left-pane text a quality engineer just saved now shows up in the
// PDF-style form/preview immediately, not just in the bare workflow field.
export const setContainment = async (db: Db, id: number, containment: string, performedBy?: number, allowedSiteIds?: number[]) => {
  const updated = await patchNcr(db, id, { containment, status: "contained" }, "containment", performedBy, ["open"], allowedSiteIds);
  await syncNcrFormData(db, id, { containmentActionText: containment }, performedBy);
  return updated;
};

export const setRootCause = async (db: Db, id: number, rootCause: string, performedBy?: number, allowedSiteIds?: number[]) => {
  const updated = await patchNcr(db, id, { rootCause, status: "investigating" }, "root_cause", performedBy, ["contained"], allowedSiteIds);
  await syncNcrFormData(db, id, { identifiedRootCauseSummary: rootCause }, performedBy);
  return updated;
};

export const setCorrectiveAction = async (db: Db, id: number, correctiveAction: string, performedBy?: number, allowedSiteIds?: number[]) => {
  const updated = await patchNcr(db, id, { correctiveAction, status: "corrective_action" }, "corrective_action", performedBy, ["investigating"], allowedSiteIds);
  await syncNcrFormData(db, id, { correctiveActionText: correctiveAction }, performedBy);
  return updated;
};

export const close = async (db: Db, id: number, performedBy?: number, allowedSiteIds?: number[]) => {
  const updated = await patchNcr(db, id, { status: "closed", closedAt: new Date() }, "closed", performedBy, ["corrective_action"], allowedSiteIds);
  await syncNcrFormData(db, id, { documentStatus: "Closed", ncrClosureDate: ncrIsoDate(updated.closedAt ?? new Date()), finalDispositionConfirmed: "Yes" }, performedBy);
  return updated;
};
