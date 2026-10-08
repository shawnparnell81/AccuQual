import type { Request, Response } from "express";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { capa } from "../../drizzle/schema/capa.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { assertRecordOnAllowedSite } from "../sites/siteAccess.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";
import { parseLimitOffset } from "../../utils/listQuery.js";
import { capaMatchesNcr, openRepeatCapa } from "../quality-automation/qualityAutomation.service.js";
import { missingRequiredLabels, requiredMoveError } from "../workflow/requiredFields.js";

export const baseHandlers = crudFactory(capa, { entityName: "CAPA", idColumn: "id", siteScoped: true });

/**
 * GET /capa — supplier, owner, status, limit, and offset use the shared list.
 * `ncrId` also matches CAPAs opened from a repeat group (`repeat_ncr_ids`).
 * `q` searches the root cause and the CAPA number for the "attach existing" picker.
 */
export const listHandler = asyncHandler(async (req: Request, res: Response) => {
  const ncrIdRaw = typeof req.query.ncrId === "string" ? req.query.ncrId : "";
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!ncrIdRaw && !q) return baseHandlers.list(req, res, () => undefined);
  if (!req.siteId) {
    res.json([]);
    return;
  }
  const conditions = [eq(capa.siteId, req.siteId)];
  if (ncrIdRaw) {
    const ncrId = Number(ncrIdRaw);
    if (!Number.isInteger(ncrId)) throw AppError.badRequest("ncrId must be an integer");
    conditions.push(capaMatchesNcr(ncrId));
  }
  if (q) {
    const asId = /^\d+$/.test(q) ? Number(q) : null;
    const text = ilike(capa.rootCause, `%${q}%`);
    conditions.push(asId != null ? or(text, eq(capa.id, asId))! : text);
  }
  const supplierId = typeof req.query.supplierId === "string" ? req.query.supplierId : "";
  if (supplierId) conditions.push(eq(capa.supplierId, Number(supplierId)));
  const ownerId = typeof req.query.ownerId === "string" ? req.query.ownerId : "";
  if (ownerId) conditions.push(eq(capa.ownerId, Number(ownerId)));
  const { limit, offset, paginated } = parseLimitOffset(req.query as Record<string, unknown>);
  const where = and(...conditions);
  const rows = await req.db!.select().from(capa).where(where).limit(limit).offset(offset);
  if (paginated) {
    const [countRow] = await req.db!.select({ count: sql<number>`count(*)::int` }).from(capa).where(where);
    res.setHeader("X-Total-Count", String(countRow?.count ?? rows.length));
  }
  res.json(rows);
});

export const openRepeatCapaHandler = asyncHandler(async (req: Request, res: Response) => {
  const ncrId = Number((req.body as { ncrId?: unknown }).ncrId);
  if (!Number.isInteger(ncrId) || ncrId < 1) throw AppError.badRequest("ncrId is required");
  const result = await openRepeatCapa(req.db!, ncrId, req.user?.id, req.allowedSiteIds);
  res.status(result.created ? 201 : 200).json(result.capa);
});

/** Status changes only through these hops. PATCH does not accept `status`. */
const ALLOWED_NEXT: Record<string, string> = {
  open: "in_progress",
  in_progress: "verifying",
  verifying: "closed",
};

async function loadCapa(req: Request, id: number) {
  const [row] = await req.db!.select().from(capa).where(and(eq(capa.id, id)));
  if (!row) throw AppError.notFound("CAPA");
  assertRecordOnAllowedSite(row.siteId, req.allowedSiteIds, "CAPA");
  return row;
}

function assertTransition(currentStatus: string, newStatus: string) {
  if (ALLOWED_NEXT[currentStatus] !== newStatus) {
    throw AppError.badRequest(`Cannot move a CAPA from "${currentStatus}" to "${newStatus}" — workflow is open -> in_progress -> verifying -> closed.`);
  }
}

export const startHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const current = await loadCapa(req, id);
  assertTransition(current.status, "in_progress");

  const [updated] = await req.db!.update(capa).set({ status: "in_progress", updatedAt: new Date() }).where(eq(capa.id, id)).returning();
  await recordAuditTrail(req.db!, { entityType: "CAPA", entityId: id, action: "status_change", changes: { action: "start" }, performedBy: req.user?.id });
  await publishEvent(WORKFLOW_STREAM, { module: "capa", event: "start", entityId: id });
  res.json(updated);
});

export const verifyHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const current = await loadCapa(req, id);
  assertTransition(current.status, "verifying");

  const [updated] = await req
    .db!.update(capa)
    .set({ verification: req.body.verification, status: "verifying", verifiedBy: req.user?.id, verifiedAt: new Date() })
    .where(eq(capa.id, id))
    .returning();
  // "CAPA" — must match crudFactory's entityName above exactly; see the QA
  // sweep review on why a casing mismatch here made this history invisible.
  await recordAuditTrail(req.db!, { entityType: "CAPA", entityId: id, action: "status_change", changes: { action: "verify" }, performedBy: req.user?.id });
  // Extends the Workflow Engine trigger already used by NCR (see the Outputs
  // Dictionary's compatibility check) — same one-line pattern, new module.
  await publishEvent(WORKFLOW_STREAM, { module: "capa", event: "verify", entityId: id });
  res.json(updated);
});

export const closeHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const current = await loadCapa(req, id);
  assertTransition(current.status, "closed");
  const missing = missingRequiredLabels(["root_cause", "verification"], { root_cause: current.rootCause, verification: current.verification });
  if (missing.length > 0) throw requiredMoveError(missing);

  const [updated] = await req.db!.update(capa).set({ status: "closed", closedAt: new Date() }).where(eq(capa.id, id)).returning();
  await recordAuditTrail(req.db!, { entityType: "CAPA", entityId: id, action: "status_change", changes: { action: "close" }, performedBy: req.user?.id });
  await publishEvent(WORKFLOW_STREAM, { module: "capa", event: "close", entityId: id });
  res.json(updated);
});
