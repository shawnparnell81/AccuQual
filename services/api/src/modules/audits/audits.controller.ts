import type { Request, Response } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import { audits, auditItems } from "../../drizzle/schema/audits.js";
import { discrepancyInvestigations } from "../../drizzle/schema/quality.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { syncDiRecordToForm } from "../quality/quality.formSync.js";
import { publishEvent, WORKFLOW_STREAM, AI_STREAM } from "../../lib/eventBus.js";
import { assertRecordOnAllowedSite } from "../sites/siteAccess.js";

export const baseHandlers = crudFactory(audits, { entityName: "Audit", idColumn: "id", siteScoped: true });

/** A logged finding is a real nonconformance once it's rated past a mere observation. */
const NONCONFORMANCE_SEVERITIES = ["minor", "major", "critical"];

export const addItemHandler = asyncHandler(async (req: Request, res: Response) => {
  const auditId = Number(req.params.id);
  const [audit] = await req.db!.select().from(audits).where(and(eq(audits.id, auditId), eq(audits.tenantId, req.tenantId!)));
  if (!audit) throw AppError.notFound("Audit");
  assertRecordOnAllowedSite(audit.siteId, req.allowedSiteIds, "Audit");

  // Once a checklist has been reordered every question has a position; a question added afterwards goes to the end.
  const [{ maxPosition } = { maxPosition: null }] = await req.db!
    .select({ maxPosition: sql<number | null>`max(${auditItems.sortOrder})` })
    .from(auditItems)
    .where(and(eq(auditItems.auditId, auditId), eq(auditItems.tenantId, req.tenantId!)));
  const [item] = await req.db!
    .insert(auditItems)
    .values({ ...req.body, auditId, tenantId: req.tenantId!, ...(maxPosition != null ? { sortOrder: Number(maxPosition) + 1 } : {}) })
    .returning();
  if (!item) throw new Error("Insert did not return the created audit item");

  // Full-System Audit finding M2 — this handler previously only ever
  // called recordAuditTrail inside the discrepancy-cascade branch below,
  // so a finding on an external audit (never cascades) or an internal
  // audit's non-nonconformance finding (observation/minor-below-threshold)
  // left no audit-trail entry for its own creation at all. Every finding
  // gets one now, regardless of whether it also happens to cascade.
  await recordAuditTrail(req.db!, {
    tenantId: req.tenantId!,
    entityType: "Audit Finding",
    entityId: item.id,
    action: "create",
    changes: { auditId, severity: item.severity, question: item.question },
    performedBy: req.user?.id,
  });

  // Same "embed" job crudFactory's generic create() already queues for
  // every other entity (see its own comment + workers/ai-worker) — this
  // handler is hand-written, not crudFactory-based, so it never got that
  // for free. Queuing it (not calling embedAndStore directly) keeps
  // embedding generation off the request path, same as everywhere else,
  // and gives AI Finding Classification's "previous similar findings"
  // (ai.assistant.ts) real history to search as findings come in.
  if (item.finding) {
    await publishEvent(AI_STREAM, { job: "embed", tenantId: req.tenantId!, entityType: "audit_finding", entityId: item.id, content: item.finding });
  }

  // Automation: a nonconformance found during an internal audit opens its
  // own Discrepancy & Inspection investigation immediately, source-linked
  // back to the audit and this specific finding — no one has to remember to
  // start it by hand.
  let discrepancy = null;
  if (audit.type === "internal" && item.severity && NONCONFORMANCE_SEVERITIES.includes(item.severity)) {
    [discrepancy] = await req
      .db!.insert(discrepancyInvestigations)
      .values({
        tenantId: req.tenantId!,
        title: `Nonconformance — ${audit.name}: ${item.question ?? `Finding #${item.id}`}`,
        description: item.finding ?? undefined,
        severity: item.severity,
        status: "open",
        autoCreated: true,
        sourceAuditId: audit.id,
        sourceAuditItemId: item.id,
      })
      .returning();
    if (!discrepancy) throw new Error("Insert did not return the created discrepancy investigation");
    // "Discrepancy investigation" — must match quality.controller.ts's
    // crudFactory entityName exactly, same reasoning as the QA sweep
    // review's History-tab casing fix.
    await recordAuditTrail(req.db!, {
      tenantId: req.tenantId!,
      entityType: "Discrepancy investigation",
      entityId: discrepancy.id,
      action: "create",
      changes: { autoCreated: true, sourceAuditId: audit.id, sourceAuditItemId: item.id, severity: item.severity },
      performedBy: req.user?.id,
    });
    // Seed the investigation form (title/severity/description/source) so it
    // opens pre-filled instead of blank.
    await syncDiRecordToForm(req.db!, req.tenantId!, discrepancy, req.user?.id);
  }

  res.status(201).json({ ...item, discrepancyInvestigation: discrepancy });
});

export const listItemsHandler = asyncHandler(async (req: Request, res: Response) => {
  const [audit] = await req.db!.select().from(audits).where(and(eq(audits.id, Number(req.params.id)), eq(audits.tenantId, req.tenantId!)));
  if (!audit) throw AppError.notFound("Audit");
  assertRecordOnAllowedSite(audit.siteId, req.allowedSiteIds, "Audit");
  const items = await req
    .db!.select()
    .from(auditItems)
    .where(and(eq(auditItems.auditId, Number(req.params.id)), eq(auditItems.tenantId, req.tenantId!)))
    // Reordered checklists follow their saved positions; ones never reordered keep creation order.
    .orderBy(sql`${auditItems.sortOrder} ASC NULLS LAST`, asc(auditItems.id));
  res.json(items);
});

/** Drag-to-reorder for the audit checklist. Every question must be listed exactly once; the list's order becomes the checklist's order. */
export const reorderItemsHandler = asyncHandler(async (req: Request, res: Response) => {
  const auditId = Number(req.params.id);
  const [audit] = await req.db!.select().from(audits).where(and(eq(audits.id, auditId), eq(audits.tenantId, req.tenantId!)));
  if (!audit) throw AppError.notFound("Audit");
  assertRecordOnAllowedSite(audit.siteId, req.allowedSiteIds, "Audit");
  if (audit.status === "completed") throw AppError.badRequest("A completed audit's checklist can't be reordered.");

  const existing = await req.db!.select({ id: auditItems.id }).from(auditItems).where(and(eq(auditItems.auditId, auditId), eq(auditItems.tenantId, req.tenantId!)));
  const ids = (req.body as { ids: number[] }).ids;
  const known = new Set(existing.map((row) => row.id));
  if (ids.length !== existing.length || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
    throw AppError.badRequest("The new order has to list every question on this audit exactly once.");
  }
  for (const [index, id] of ids.entries()) {
    await req.db!.update(auditItems).set({ sortOrder: index + 1 }).where(eq(auditItems.id, id));
  }
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "Audit", entityId: auditId, action: "update", changes: { subAction: "items_reordered", order: ids }, performedBy: req.user?.id });

  const items = await req.db!.select().from(auditItems).where(and(eq(auditItems.auditId, auditId), eq(auditItems.tenantId, req.tenantId!))).orderBy(sql`${auditItems.sortOrder} ASC NULLS LAST`, asc(auditItems.id));
  res.json(items);
});

/** Scheduled -> In Progress. Previously only reachable via the generic PATCH with no sequence check at all (see the Rules Dictionary). */
export const startHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const tenantId = req.tenantId!;
  const [audit] = await req.db!.select().from(audits).where(and(eq(audits.id, id), eq(audits.tenantId, tenantId)));
  if (!audit) throw AppError.notFound("Audit");
  assertRecordOnAllowedSite(audit.siteId, req.allowedSiteIds, "Audit");
  if (audit.status !== "scheduled") throw AppError.badRequest(`Cannot start an audit from status "${audit.status}" — must be "scheduled"`);

  const [updated] = await req.db!.update(audits).set({ status: "in_progress" }).where(eq(audits.id, id)).returning();

  await recordAuditTrail(req.db!, { tenantId, entityType: "Audit", entityId: id, action: "status_change", changes: { action: "start" }, performedBy: req.user?.id });
  await publishEvent(WORKFLOW_STREAM, { tenantId, module: "audit", event: "start", entityId: id });

  res.json(updated);
});

export const completeHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const tenantId = req.tenantId!;
  const [audit] = await req.db!.select().from(audits).where(and(eq(audits.id, id), eq(audits.tenantId, tenantId)));
  if (!audit) throw AppError.notFound("Audit");
  assertRecordOnAllowedSite(audit.siteId, req.allowedSiteIds, "Audit");
  if (audit.status !== "in_progress") throw AppError.badRequest(`Cannot complete an audit from status "${audit.status}" — must be "in_progress"`);

  const [updated] = await req.db!.update(audits).set({ status: "completed", completedAt: new Date() }).where(eq(audits.id, id)).returning();

  // Was missing entirely (see the Outputs Dictionary) — the one dedicated
  // transition in the app that left no audit trail of itself.
  await recordAuditTrail(req.db!, { tenantId, entityType: "Audit", entityId: id, action: "status_change", changes: { action: "complete" }, performedBy: req.user?.id });
  await publishEvent(WORKFLOW_STREAM, { tenantId, module: "audit", event: "complete", entityId: id });

  res.json(updated);
});
