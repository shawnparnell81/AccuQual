import type { Request, Response } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import { audits, auditItems } from "../../drizzle/schema/audits.js";
import { discrepancyInvestigations } from "../../drizzle/schema/quality.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { getUserAccessLevel } from "../../middleware/departmentAccess.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { AUDIT_NUMBER } from "../records/recordNumberSpecs.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { syncDiRecordToForm } from "../quality/quality.formSync.js";
import { mapSeverityToClassification, ncrIsoDate, syncNcrFormData } from "../ncr/ncr.formSync.js";
import { publishEvent, WORKFLOW_STREAM, AI_STREAM } from "../../lib/eventBus.js";
import { assertRecordOnAllowedSite } from "../sites/siteAccess.js";
import { fileOnFirstSave } from "../document-folders/defaultFormFiling.js";
import type { Db } from "../../lib/requestDb.js";

export const baseHandlers = crudFactory(audits, { entityName: "Audit", idColumn: "id", siteScoped: true, recordNumber: AUDIT_NUMBER, blankCreatePath: "/audits" });

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

  res.status(201).json(item);
});

function ncrSeverityFromAudit(severity: string | null): string | null {
  if (severity === "critical") return "critical";
  if (severity === "major") return "high";
  if (severity === "minor") return "low";
  return null;
}

function investigationSeverity(severity: string | null): string | null {
  if (severity === "minor" || severity === "major" || severity === "critical") return severity;
  return null;
}

function transferredText(item: { question: string | null; finding: string | null; evidence: string | null }): { title: string; description: string } {
  const title = (item.question?.trim() || item.finding?.trim() || "Audit finding").slice(0, 200);
  const parts = [item.finding?.trim(), item.evidence?.trim() ? `Evidence: ${item.evidence.trim()}` : ""].filter(Boolean);
  return { title, description: parts.join("\n") };
}

async function requireEdit(req: Request, resource: "di" | "ncr", message: string): Promise<void> {
  if (!req.user) throw AppError.forbidden(message);
  if ((await getUserAccessLevel(req.db!, req.user, resource)) !== "edit") throw AppError.forbidden(message);
}

/** Opens only a Discrepancy Investigation from this item. A second call returns the same one. */
export const createInvestigationHandler = asyncHandler(async (req: Request, res: Response) => {
  const { audit, item } = await loadAuditItem(req, Number(req.params.id), Number(req.params.itemId));
  await requireEdit(req, "di", "Creating an investigation needs edit access to Discrepancy Investigations.");
  const { title, description } = transferredText(item);
  const [existing] = await req
    .db!.select()
    .from(discrepancyInvestigations)
    .where(and(eq(discrepancyInvestigations.sourceAuditId, audit.id), eq(discrepancyInvestigations.sourceAuditItemId, item.id)));
  if (existing) {
    res.status(200).json(existing);
    return;
  }
  const [created] = await req
    .db!.insert(discrepancyInvestigations)
    .values({
      title,
      description: description || null,
      severity: investigationSeverity(item.severity),
      status: "open",
      autoCreated: false,
      sourceAuditId: audit.id,
      sourceAuditItemId: item.id,
    })
    .returning();
  if (!created) throw new Error("Insert did not return the created discrepancy investigation");
  await recordAuditTrail(req.db!, {
    entityType: "Discrepancy investigation",
    entityId: created.id,
    action: "create",
    changes: { openedFrom: "audit item", severity: created.severity, title: created.title },
    performedBy: req.user?.id,
  });
  await syncDiRecordToForm(req.db!, created, req.user?.id);
  await recordAuditTrail(req.db!, {
    entityType: "Audit",
    entityId: audit.id,
    action: "create",
    changes: { event: "investigation_opened", question: item.question },
    performedBy: req.user?.id,
  });
  res.status(201).json(created);
});

/** Opens only an NCR from this item. A second call returns the same one. */
export const createNcrHandler = asyncHandler(async (req: Request, res: Response) => {
  const { audit, item } = await loadAuditItem(req, Number(req.params.id), Number(req.params.itemId));
  await requireEdit(req, "ncr", "Creating an NCR needs edit access to NCRs.");
  const { title, description } = transferredText(item);
  const [existing] = await req
    .db!.select()
    .from(ncr)
    .where(and(eq(ncr.isDeleted, false), sql`(${ncr.processData}->>'sourceAuditItemId') = ${String(item.id)}`));
  if (existing) {
    res.status(200).json(existing);
    return;
  }
  const severity = ncrSeverityFromAudit(item.severity);
  const [created] = await req
    .db!.insert(ncr)
    .values({
      title,
      description: description || null,
      severity,
      status: "ncr_created",
      createdBy: req.user?.id,
      ...(audit.siteId ? { siteId: audit.siteId } : {}),
      processData: { sourceAuditId: audit.id, sourceAuditItemId: item.id },
    })
    .returning();
  if (!created) throw new Error("Insert did not return the created NCR");
  await recordAuditTrail(req.db!, {
    entityType: "NCR",
    entityId: created.id,
    action: "create",
    changes: { openedFrom: "audit item", title: created.title, severity: created.severity },
    performedBy: req.user?.id,
  });
  await syncNcrFormData(
    req.db!,
    created.id,
    {
      dateIssued: ncrIsoDate(created.createdAt ?? new Date()),
      documentStatus: "Active",
      nonconformanceDescription: created.description ?? undefined,
      ncrClassification: mapSeverityToClassification(created.severity),
    },
    req.user?.id,
  );
  await recordAuditTrail(req.db!, {
    entityType: "Audit",
    entityId: audit.id,
    action: "create",
    changes: { event: "ncr_opened", question: item.question },
    performedBy: req.user?.id,
  });
  res.status(201).json(created);
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
  const ncrLinks = await req
    .db!.select({ id: ncr.id, processData: ncr.processData })
    .from(ncr)
    .where(and(eq(ncr.isDeleted, false), sql`(${ncr.processData}->>'sourceAuditId') = ${String(audit.id)}`));
  const ncrByItem = new Map<number, number>();
  for (const row of ncrLinks) {
    const sourceId = row.processData?.sourceAuditItemId;
    if (typeof sourceId === "number") ncrByItem.set(sourceId, row.id);
  }
  res.json(items.map((item) => ({ ...item, discrepancyInvestigationId: byItem.get(item.id) ?? null, ncrId: ncrByItem.get(item.id) ?? null })));
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
  }
}
