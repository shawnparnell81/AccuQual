import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { capa } from "../../drizzle/schema/capa.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { assertRecordOnAllowedSite } from "../sites/siteAccess.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";

export const baseHandlers = crudFactory(capa, { entityName: "CAPA", idColumn: "id", siteScoped: true });

/** GET /capa — Phase 8 adds an optional `?supplierId=` filter (same reasoning as ncr.controller.ts's own listHandler) for the receiving → CAPA traceability chain; falls through to baseHandlers.list's plain query when omitted. */
export const listHandler = asyncHandler(async (req: Request, res: Response) => {
  const { supplierId } = req.query as Record<string, string | undefined>;
  if (!supplierId) return baseHandlers.list(req, res, () => undefined);
  if (!req.siteId) {
    res.json([]);
    return;
  }
  const rows = await req.db!.select().from(capa).where(and(eq(capa.siteId, req.siteId), eq(capa.supplierId, Number(supplierId))));
  res.json(rows);
});

/**
 * Sprint 2 fix (accuqual-implementation-sequencing.md) — matches the same
 * ALLOWED_NEXT/transition() shape risk.controller.ts already uses. Two of
 * these three hops (in_progress -> verifying -> closed) were already
 * individually guarded by ad hoc inline `if` checks in verifyHandler/
 * closeHandler below; the real gap was open -> in_progress, which had NO
 * dedicated endpoint at all (the live "Start CAPA" button on
 * CapaDetailPage.tsx called the generic, unguarded PATCH via useWorkflowUpdate
 * — see that hook's own comment: "used where a transition has no dedicated
 * endpoint yet"). Consolidating all three into one map + helper here, and
 * updating the frontend to call the new dedicated /start endpoint below via
 * useWorkflowAction like verify/close already do, closes both the missing
 * endpoint AND the underlying free-PATCH bypass (updateCapaSchema no longer
 * accepts a raw `status` field at all — see capa.validation.ts).
 */
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

  const [updated] = await req.db!.update(capa).set({ status: "closed", closedAt: new Date() }).where(eq(capa.id, id)).returning();
  await recordAuditTrail(req.db!, { entityType: "CAPA", entityId: id, action: "status_change", changes: { action: "close" }, performedBy: req.user?.id });
  await publishEvent(WORKFLOW_STREAM, { module: "capa", event: "close", entityId: id });
  res.json(updated);
});
