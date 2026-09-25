import type { NextFunction, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { complaints, type Complaint } from "../../drizzle/schema/complaints.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { assertTenantUser } from "../../utils/assertTenantUser.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";
import { getUserAccessLevel } from "../../middleware/departmentAccess.js";
import { syncNcrFormData, mapSeverityToClassification, ncrIsoDate } from "../ncr/ncr.formSync.js";
import { syncComplaintRecordToForm } from "./complaints.formSync.js";

export const baseHandlers = crudFactory(complaints, {
  entityName: "Complaint",
  idColumn: "id",
  afterCreate: async (created, req) => {
    await syncComplaintRecordToForm(req.db!, created as unknown as Complaint, req.user?.id);
  },
});

async function loadOwned(req: Request): Promise<Complaint> {
  const [row] = await req.db!.select().from(complaints).where(and(eq(complaints.id, Number(req.params.id))));
  if (!row) throw AppError.notFound("Complaint");
  return row;
}

async function assertNcrInTenant(req: Request, ncrId: number): Promise<void> {
  const [row] = await req.db!.select({ id: ncr.id }).from(ncr).where(and(eq(ncr.id, ncrId), eq(ncr.isDeleted, false)));
  if (!row) throw AppError.badRequest("Linked NCR not found in this organization.");
}

/** A linked NCR and an assignee must belong to THIS tenant — both are bare ids on the row (linkedNcrId is not even a foreign key). */
export const verifyReferences = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  if (req.body.linkedNcrId) await assertNcrInTenant(req, req.body.linkedNcrId);
  if (req.body.assignedTo) await assertTenantUser(req.db!, req.body.assignedTo);
  next();
});

/** Edits to the descriptive fields. Status is not editable here (see complaints.validation.ts), and a closed complaint is immutable. */
export const updateHandler = asyncHandler(async (req: Request, res: Response) => {
  const current = await loadOwned(req);
  if (current.status === "closed") throw AppError.badRequest("A closed complaint cannot be edited.");

  const [updated] = await req
    .db!.update(complaints)
    .set({ ...req.body, updatedAt: new Date() })
    .where(and(eq(complaints.id, current.id)))
    .returning();
  await recordAuditTrail(req.db!, { entityType: "Complaint", entityId: current.id, action: "update", changes: req.body, performedBy: req.user?.id });
  await syncComplaintRecordToForm(req.db!, updated!, req.user?.id);
  res.json(updated);
});

/**
 * open -> investigating -> resolved -> closed, one guarded hop at a time.
 * A resolved complaint can be sent back to investigating (the fix did not
 * hold); a closed one is final.
 */
async function transition(
  req: Request,
  res: Response,
  opts: { from: string[]; to: string; event: string; extra?: (current: Complaint) => Partial<typeof complaints.$inferInsert> }
) {
  const current = await loadOwned(req);
  if (!opts.from.includes(current.status)) {
    throw AppError.badRequest(`Cannot ${opts.event} a complaint from status "${current.status}" — must be ${opts.from.map((s) => `"${s}"`).join(" or ")}`);
  }

  const [updated] = await req
    .db!.update(complaints)
    .set({ ...(opts.extra?.(current) ?? {}), status: opts.to, updatedAt: new Date() })
    .where(and(eq(complaints.id, current.id)))
    .returning();
  await recordAuditTrail(req.db!, {
    entityType: "Complaint",
    entityId: current.id,
    action: "status_change",
    changes: { action: opts.event, from: current.status, to: opts.to },
    performedBy: req.user?.id,
  });
  await publishEvent(WORKFLOW_STREAM, { module: "complaints", event: opts.event, entityId: current.id });
  await syncComplaintRecordToForm(req.db!, updated!, req.user?.id);
  res.json(updated);
}

export const investigateHandler = asyncHandler(async (req: Request, res: Response) => {
  await transition(req, res, { from: ["open", "resolved"], to: "investigating", event: "investigate", extra: () => ({ resolvedAt: null }) });
});

/** Resolving needs the resolution written down — supplied in the request or already saved on the complaint. */
export const resolveHandler = asyncHandler(async (req: Request, res: Response) => {
  const current = await loadOwned(req);
  const resolution = (req.body.resolution as string | undefined)?.trim() || current.resolution?.trim();
  if (current.status === "investigating" && !resolution) throw AppError.badRequest("Describe the resolution before marking this complaint resolved.");
  await transition(req, res, { from: ["investigating"], to: "resolved", event: "resolve", extra: () => ({ resolution, resolvedAt: new Date() }) });
});

export const closeHandler = asyncHandler(async (req: Request, res: Response) => {
  await transition(req, res, { from: ["resolved"], to: "closed", event: "close", extra: () => ({ closedAt: new Date() }) });
});

/**
 * Opens a real NCR from this complaint and links the two — the one-click
 * version of "create an NCR, then paste its id into linkedNcrId by hand".
 * Needs edit access to NCRs, not just to complaints: a department that can
 * log complaints should not get to create NCRs through this door.
 */
export const escalateToNcrHandler = asyncHandler(async (req: Request, res: Response) => {
  const current = await loadOwned(req);
  if (current.status === "closed") throw AppError.badRequest("A closed complaint cannot be escalated.");
  if (current.linkedNcrId) throw AppError.badRequest(`This complaint is already linked to NCR #${current.linkedNcrId}.`);
  if ((await getUserAccessLevel(req.db!, req.user!, "ncr")) !== "edit") {
    throw AppError.forbidden("Escalating a complaint creates an NCR — you need edit access to NCRs.");
  }

  const title = `Customer complaint #${current.id}${current.customerName ? ` — ${current.customerName}` : ""}`.slice(0, 200);
  const [createdNcr] = await req.db!.insert(ncr).values({ title, description: current.description, severity: current.severity ?? undefined, createdBy: req.user?.id, ...(req.siteId ? { siteId: req.siteId } : {}) }).returning();
  await recordAuditTrail(req.db!, { entityType: "NCR", entityId: createdNcr!.id, action: "create", changes: { fromComplaintId: current.id }, performedBy: req.user?.id });
  await syncNcrFormData(
    req.db!,
    createdNcr!.id,
    {
      ncrNumber: `NCR-${createdNcr!.id}`,
      dateIssued: ncrIsoDate(createdNcr!.createdAt ?? new Date()),
      documentStatus: "Active",
      nonconformanceDescription: createdNcr!.description ?? undefined,
      ncrClassification: mapSeverityToClassification(createdNcr!.severity),
    },
    req.user?.id
  );

  const [updated] = await req
    .db!.update(complaints)
    .set({ linkedNcrId: createdNcr!.id, updatedAt: new Date() })
    .where(and(eq(complaints.id, current.id)))
    .returning();
  await recordAuditTrail(req.db!, { entityType: "Complaint", entityId: current.id, action: "update", changes: { action: "escalate_to_ncr", linkedNcrId: createdNcr!.id }, performedBy: req.user?.id });
  res.status(201).json({ complaint: updated, ncr: createdNcr });
});
