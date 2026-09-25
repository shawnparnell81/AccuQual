import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { discrepancyInvestigations, type DiscrepancyInvestigation } from "../../drizzle/schema/quality.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { assertCompanyUser } from "../../utils/assertTenantUser.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";
import { syncDiRecordToForm } from "./quality.formSync.js";

// Creating a discrepancy also seeds its investigation form (title/severity/
// description/status), so the form isn't blank when someone opens it — see
// quality.formSync.ts.
export const baseHandlers = crudFactory(discrepancyInvestigations, {
  entityName: "Discrepancy investigation",
  idColumn: "id",
  afterCreate: async (created, req) => {
    await syncDiRecordToForm(req.db!, created as unknown as DiscrepancyInvestigation, req.user?.id);
  },
});

async function loadOwned(req: Request): Promise<DiscrepancyInvestigation> {
  const [row] = await req
    .db!.select()
    .from(discrepancyInvestigations)
    .where(and(eq(discrepancyInvestigations.id, Number(req.params.id))));
  if (!row) throw AppError.notFound("Discrepancy investigation");
  return row;
}

/** Edits to the descriptive fields. Status is not editable here (see quality.validation.ts), and a closed investigation is immutable. */
export const updateHandler = asyncHandler(async (req: Request, res: Response) => {
  const current = await loadOwned(req);
  if (current.status === "closed") throw AppError.badRequest("A closed discrepancy investigation cannot be edited.");
  if (req.body.assignedTo) await assertCompanyUser(req.db!, req.body.assignedTo);

  const [updated] = await req
    .db!.update(discrepancyInvestigations)
    .set({ ...req.body, updatedAt: new Date() })
    .where(and(eq(discrepancyInvestigations.id, current.id)))
    .returning();
  await recordAuditTrail(req.db!, {
    entityType: "Discrepancy investigation",
    entityId: current.id,
    action: "update",
    changes: req.body,
    performedBy: req.user?.id,
  });
  await syncDiRecordToForm(req.db!, updated!, req.user?.id);
  res.json(updated);
});

/**
 * One guarded hop of open -> investigating -> disposed -> closed. The audit
 * entityType "Discrepancy investigation" must match crudFactory's entityName
 * above exactly (see the QA sweep review on why a casing mismatch made this
 * history invisible).
 */
async function transition(req: Request, res: Response, opts: { from: string; to: string; event: string; extra?: (current: DiscrepancyInvestigation) => Partial<typeof discrepancyInvestigations.$inferInsert> }) {
  const current = await loadOwned(req);
  if (current.status !== opts.from) {
    throw AppError.badRequest(`Cannot ${opts.event} a discrepancy investigation from status "${current.status}" — must be "${opts.from}"`);
  }

  const [updated] = await req
    .db!.update(discrepancyInvestigations)
    .set({ ...(opts.extra?.(current) ?? {}), status: opts.to, updatedAt: new Date() })
    .where(and(eq(discrepancyInvestigations.id, current.id)))
    .returning();
  await recordAuditTrail(req.db!, {
    entityType: "Discrepancy investigation",
    entityId: current.id,
    action: "status_change",
    changes: { action: opts.event, from: opts.from, to: opts.to },
    performedBy: req.user?.id,
  });
  await publishEvent(WORKFLOW_STREAM, { module: "di", event: opts.event, entityId: current.id });
  await syncDiRecordToForm(req.db!, updated!, req.user?.id);
  res.json(updated);
}

export const investigateHandler = asyncHandler(async (req: Request, res: Response) => {
  await transition(req, res, { from: "open", to: "investigating", event: "investigate" });
});

/** Disposing needs a disposition — supplied in the request or already set on the record. */
export const disposeHandler = asyncHandler(async (req: Request, res: Response) => {
  const current = await loadOwned(req);
  const disposition = (req.body.disposition as string | undefined) ?? current.disposition;
  if (current.status === "investigating" && !disposition) {
    throw AppError.badRequest("Select a disposition before marking this investigation disposed.");
  }
  await transition(req, res, { from: "investigating", to: "disposed", event: "dispose", extra: () => ({ disposition }) });
});

export const closeHandler = asyncHandler(async (req: Request, res: Response) => {
  await transition(req, res, { from: "disposed", to: "closed", event: "close" });
});
