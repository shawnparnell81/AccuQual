import type { Request, Response } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import { audits, auditItems } from "../../drizzle/schema/audits.js";
import { discrepancyInvestigations } from "../../drizzle/schema/quality.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { AUDIT_NUMBER } from "../records/recordNumberSpecs.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { syncDiRecordToForm } from "../quality/quality.formSync.js";
import { publishEvent, WORKFLOW_STREAM, AI_STREAM } from "../../lib/eventBus.js";
import { assertRecordOnAllowedSite } from "../sites/siteAccess.js";
import { fileOnFirstSave } from "../document-folders/defaultFormFiling.js";
import type { Db } from "../../lib/requestDb.js";

export const baseHandlers = crudFactory(audits, { entityName: "Audit", idColumn: "id", siteScoped: true, recordNumber: AUDIT_NUMBER, blankCreatePath: "/audits" });

/** A logged finding is a real nonconformance once it's rated past a mere observation. */
const NONCONFORMANCE_SEVERITIES = ["minor", "major", "critical"];

export const addItemHandler = asyncHandler(async (req: Request, res: Response) => {
  const auditId = Number(req.params.id);
  const [audit] = await req.db!.select().from(audits).where(and(eq(audits.id, auditId)));
  if (!audit) throw AppError.notFound("Audit");
  assertRecordOnAllowedSite(audit.siteId, req.allowedSiteIds, "Audit");

  // Once a checklist has been reordered every question has a position; a question added afterwards goes to the end.
  const [{ maxPosition } = { maxPosition: null }] = await req.db!
    .select({ maxPosition: sql<number | null>`max(${auditItems.sortOrder})` })
    .from(auditItems)
    .where(and(eq(auditItems.auditId, auditId)));
  const [item] = await req.db!
    .insert(auditItems)
    .values({ ...req.body, auditId, ...(maxPosition != null ? { sortOrder: Number(maxPosition) + 1 } : {}) })
    .returning();
  if (!item) throw new Error("Insert did not return the created audit item");

  // Full-System Audit finding M2 — this handler previously only ever
  // called recordAuditTrail inside the discrepancy-cascade branch below,
  // so a finding on an external audit (never cascades) or an internal
  // audit's non-nonconformance finding (observation/minor-below-threshold)
  // left no audit-trail entry for its own creation at all. Every finding
  // gets one now, regardless of whether it also happens to cascade.
  await recordAuditTrail(req.db!, {
    entityType: "Audit Finding",
    entityId: item.id,
    action: "create",
    changes: { auditId, severity: item.severity, question: item.question },
    performedBy: req.user?.id,
  });
  await logAuditItem(req.db!, auditId, "item_added", itemFieldEdits({}, item), req.user?.id);
  await fileAudit(req.db!, audit, req.user?.id);

  // Same "embed" job crudFactory's generic create() already queues for
  // every other entity (see its own comment + workers/ai-worker) — this
  // handler is hand-written, not crudFactory-based, so it never got that
  // for free. Queuing it (not calling embedAndStore directly) keeps
  // embedding generation off the request path, same as everywhere else,
  // and gives AI Finding Classification's "previous similar findings"
  // (ai.assistant.ts) real history to search as findings come in.
  if (item.finding) {
    await publishEvent(AI_STREAM, { job: "embed", entityType: "audit_finding", entityId: item.id, content: item.finding });
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
        title: `Nonconformance — ${audit.name}: ${item.question ?? "Finding"}`,
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
      entityType: "Discrepancy investigation",
      entityId: discrepancy.id,
      action: "create",
      changes: { autoCreated: true, sourceAuditId: audit.id, sourceAuditItemId: item.id, severity: item.severity },
      performedBy: req.user?.id,
    });
    // Seed the investigation form (title/severity/description/source) so it
    // opens pre-filled instead of blank.
    await syncDiRecordToForm(req.db!, discrepancy, req.user?.id);
    await recordAuditTrail(req.db!, {
      entityType: "Audit",
      entityId: audit.id,
      action: "create",
      changes: { event: "item_added", discrepancyInvestigationId: discrepancy.id },
      performedBy: req.user?.id,
    });
  }

  res.status(201).json({ ...item, discrepancyInvestigation: discrepancy });
});

export const listItemsHandler = asyncHandler(async (req: Request, res: Response) => {
  const [audit] = await req.db!.select().from(audits).where(and(eq(audits.id, Number(req.params.id))));
  if (!audit) throw AppError.notFound("Audit");
  assertRecordOnAllowedSite(audit.siteId, req.allowedSiteIds, "Audit");
  const items = await req
    .db!.select()
    .from(auditItems)
    .where(and(eq(auditItems.auditId, Number(req.params.id))))
    // Reordered checklists follow their saved positions; ones never reordered keep creation order.
    .orderBy(sql`${auditItems.sortOrder} ASC NULLS LAST`, asc(auditItems.id));
  const links = await req
    .db!.select({ id: discrepancyInvestigations.id, sourceAuditItemId: discrepancyInvestigations.sourceAuditItemId })
    .from(discrepancyInvestigations)
    .where(eq(discrepancyInvestigations.sourceAuditId, audit.id));
  const byItem = new Map(links.filter((row) => row.sourceAuditItemId != null).map((row) => [row.sourceAuditItemId as number, row.id]));
  res.json(items.map((item) => ({ ...item, discrepancyInvestigationId: byItem.get(item.id) ?? null })));
});

/** Drag-to-reorder for the audit checklist. Every question must be listed exactly once; the list's order becomes the checklist's order. */
export const reorderItemsHandler = asyncHandler(async (req: Request, res: Response) => {
  const auditId = Number(req.params.id);
  const [audit] = await req.db!.select().from(audits).where(and(eq(audits.id, auditId)));
  if (!audit) throw AppError.notFound("Audit");
  assertRecordOnAllowedSite(audit.siteId, req.allowedSiteIds, "Audit");
  if (audit.status === "completed") throw AppError.badRequest("A completed audit's checklist can't be reordered.");

  const existing = await req.db!.select({ id: auditItems.id }).from(auditItems).where(and(eq(auditItems.auditId, auditId)));
  const ids = (req.body as { ids: number[] }).ids;
  const known = new Set(existing.map((row) => row.id));
  if (ids.length !== existing.length || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
    throw AppError.badRequest("The new order has to list every question on this audit exactly once.");
  }
  for (const [index, id] of ids.entries()) {
    await req.db!.update(auditItems).set({ sortOrder: index + 1 }).where(eq(auditItems.id, id));
  }
  await recordAuditTrail(req.db!, { entityType: "Audit", entityId: auditId, action: "update", changes: { subAction: "items_reordered", order: ids }, performedBy: req.user?.id });

  const items = await req.db!.select().from(auditItems).where(and(eq(auditItems.auditId, auditId))).orderBy(sql`${auditItems.sortOrder} ASC NULLS LAST`, asc(auditItems.id));
  res.json(items);
});

/** Scheduled -> In Progress. Previously only reachable via the generic PATCH with no sequence check at all (see the Rules Dictionary). */
export const startHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [audit] = await req.db!.select().from(audits).where(and(eq(audits.id, id)));
  if (!audit) throw AppError.notFound("Audit");
  assertRecordOnAllowedSite(audit.siteId, req.allowedSiteIds, "Audit");
  if (audit.status !== "scheduled") throw AppError.badRequest(`Cannot start an audit from status "${audit.status}" — must be "scheduled"`);

  const [updated] = await req.db!.update(audits).set({ status: "in_progress" }).where(eq(audits.id, id)).returning();

  await recordAuditTrail(req.db!, { entityType: "Audit", entityId: id, action: "status_change", changes: { action: "start" }, performedBy: req.user?.id });
  await fileAudit(req.db!, audit, req.user?.id);
  await publishEvent(WORKFLOW_STREAM, { module: "audit", event: "start", entityId: id });

  res.json(updated);
});

export const completeHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [audit] = await req.db!.select().from(audits).where(and(eq(audits.id, id)));
  if (!audit) throw AppError.notFound("Audit");
  assertRecordOnAllowedSite(audit.siteId, req.allowedSiteIds, "Audit");
  if (audit.status !== "in_progress") throw AppError.badRequest(`Cannot complete an audit from status "${audit.status}" — must be "in_progress"`);

  const [updated] = await req.db!.update(audits).set({ status: "completed", completedAt: new Date() }).where(eq(audits.id, id)).returning();

  // Was missing entirely (see the Outputs Dictionary) — the one dedicated
  // transition in the app that left no audit trail of itself.
  await recordAuditTrail(req.db!, { entityType: "Audit", entityId: id, action: "status_change", changes: { action: "complete" }, performedBy: req.user?.id });
  await fileAudit(req.db!, audit, req.user?.id);
  await publishEvent(WORKFLOW_STREAM, { module: "audit", event: "complete", entityId: id });

  res.json(updated);
});

const ITEM_FIELDS = [
  ["question", "Question"],
  ["finding", "Finding"],
  ["severity", "Severity"],
  ["evidence", "Evidence"],
] as const;

function shownItemValue(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  return trimmed || "(blank)";
}

function itemFieldEdits(
  before: { question?: string | null; finding?: string | null; severity?: string | null; evidence?: string | null },
  after: { question?: string | null; finding?: string | null; severity?: string | null; evidence?: string | null },
  keys?: ReadonlySet<string>,
) {
  const edits: { label: string; from: string; to: string }[] = [];
  for (const [key, label] of ITEM_FIELDS) {
    if (keys && !keys.has(key)) continue;
    const from = shownItemValue(before[key]);
    const to = shownItemValue(after[key]);
    if (from === to) continue;
    edits.push({ label, from, to });
  }
  return edits;
}

async function fileAudit(db: Db, audit: { id: number }, userId: number | undefined) {
  await fileOnFirstSave(db, "/audits", audit, audit as Record<string, unknown>, { saved: true }, userId);
}

async function logAuditItem(db: Db, auditId: number, event: "item_added" | "item_updated" | "item_removed", edits: { label: string; from: string; to: string }[], userId: number | undefined) {
  if (edits.length === 0 && event === "item_updated") return;
  await recordAuditTrail(db, {
    entityType: "Audit",
    entityId: auditId,
    action: event === "item_removed" ? "delete" : event === "item_added" ? "create" : "update",
    changes: { event, edits },
    performedBy: userId,
  });
}

async function loadAuditItem(req: Request, auditId: number, itemId: number) {
  const [audit] = await req.db!.select().from(audits).where(eq(audits.id, auditId));
  if (!audit) throw AppError.notFound("Audit");
  assertRecordOnAllowedSite(audit.siteId, req.allowedSiteIds, "Audit");
  const [item] = await req.db!.select().from(auditItems).where(and(eq(auditItems.id, itemId), eq(auditItems.auditId, auditId)));
  if (!item) throw AppError.notFound("Audit item");
  return { audit, item };
}

/** Header Save files the audit once, even when the name did not change. */
export const saveAuditHandler = asyncHandler(async (req: Request, res: Response) => {
  const auditId = Number(req.params.id);
  const [audit] = await req.db!.select().from(audits).where(eq(audits.id, auditId));
  if (!audit) throw AppError.notFound("Audit");
  assertRecordOnAllowedSite(audit.siteId, req.allowedSiteIds, "Audit");
  await fileAudit(req.db!, audit, req.user?.id);
  res.json(audit);
});

export const updateItemHandler = asyncHandler(async (req: Request, res: Response) => {
  const auditId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const { audit, item } = await loadAuditItem(req, auditId, itemId);
  const body = req.body as { question?: string; finding?: string | null; severity?: string | null; evidence?: string | null };
  const patch: { question?: string; finding?: string | null; severity?: string | null; evidence?: string | null } = {};
  if (body.question !== undefined) patch.question = body.question;
  if (body.finding !== undefined) patch.finding = body.finding;
  if (body.severity !== undefined) patch.severity = body.severity;
  if (body.evidence !== undefined) patch.evidence = body.evidence;
  const [updated] = await req.db!.update(auditItems).set(patch).where(eq(auditItems.id, item.id)).returning();
  if (!updated) throw AppError.notFound("Audit item");
  await logAuditItem(req.db!, auditId, "item_updated", itemFieldEdits(item, updated, new Set(Object.keys(patch))), req.user?.id);
  await fileAudit(req.db!, audit, req.user?.id);
  res.json(updated);
});

export const deleteItemHandler = asyncHandler(async (req: Request, res: Response) => {
  const auditId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const { audit, item } = await loadAuditItem(req, auditId, itemId);
  await req.db!.update(discrepancyInvestigations).set({ sourceAuditItemId: null }).where(eq(discrepancyInvestigations.sourceAuditItemId, item.id));
  await req.db!.delete(auditItems).where(eq(auditItems.id, item.id));
  await logAuditItem(
    req.db!,
    auditId,
    "item_removed",
    itemFieldEdits(item, { question: null, finding: null, severity: null, evidence: null }),
    req.user?.id,
  );
  await fileAudit(req.db!, audit, req.user?.id);
  res.status(204).send();
});

function cellText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function checked(value: unknown, option: string): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>)[option] === true);
}

function checklistSeverity(response: unknown): string {
  if (checked(response, "Nonconformity")) return "minor";
  return "observation";
}

/** Audit Checklist rows are the same checklist as Audit Items. A save writes the items; it does not delete rows typed on the audit itself. */
export async function syncAuditChecklist(db: Db, auditId: number, data: Record<string, unknown>, userId?: number): Promise<void> {
  const [audit] = await db.select().from(audits).where(eq(audits.id, auditId));
  if (!audit) return;
  const checklist = Array.isArray(data.checklistItems) ? data.checklistItems : [];
  const findings = Array.isArray(data.findings) ? data.findings : [];
  const wanted: { question: string; finding: string; severity: string }[] = [];
  for (const row of checklist) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const question = cellText(record.question);
    if (!question) continue;
    wanted.push({ question, finding: cellText(record.evidenceComments), severity: checklistSeverity(record.response) });
  }
  for (const row of findings) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const description = cellText(record.description);
    if (!description) continue;
    wanted.push({
      question: description,
      finding: description,
      severity: checked(record.correctiveActionRequired, "Yes") ? "minor" : "observation",
    });
  }
  if (wanted.length === 0) return;
  const existing = await db.select().from(auditItems).where(eq(auditItems.auditId, auditId));
  for (const row of wanted) {
    const match = existing.find((item) => (item.question ?? "") === row.question);
    if (match) {
      if ((match.finding ?? "") === row.finding && (match.severity ?? "") === row.severity) continue;
      await db.update(auditItems).set({ finding: row.finding || null, severity: row.severity }).where(eq(auditItems.id, match.id));
      continue;
    }
    const [created] = await db
      .insert(auditItems)
      .values({ auditId, question: row.question, finding: row.finding || null, severity: row.severity })
      .returning();
    if (!created) continue;
    existing.push(created);
    await logAuditItem(db, auditId, "item_added", itemFieldEdits({}, created), userId);
    if (audit.type === "internal" && NONCONFORMANCE_SEVERITIES.includes(row.severity)) {
      const [discrepancy] = await db
        .insert(discrepancyInvestigations)
        .values({
          title: `Nonconformance — ${audit.name}: ${row.question}`,
          description: row.finding || undefined,
          severity: row.severity,
          status: "open",
          autoCreated: true,
          sourceAuditId: audit.id,
          sourceAuditItemId: created.id,
        })
        .returning();
      if (!discrepancy) continue;
      await recordAuditTrail(db, {
        entityType: "Discrepancy investigation",
        entityId: discrepancy.id,
        action: "create",
        changes: { autoCreated: true, sourceAuditId: audit.id, sourceAuditItemId: created.id, severity: row.severity },
        performedBy: userId,
      });
      await syncDiRecordToForm(db, discrepancy, userId);
      await recordAuditTrail(db, {
        entityType: "Audit",
        entityId: audit.id,
        action: "create",
        changes: { event: "item_added", discrepancyInvestigationId: discrepancy.id },
        performedBy: userId,
      });
    }
  }
}
