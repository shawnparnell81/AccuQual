import type { Request, Response } from "express";
import { and, eq, desc } from "drizzle-orm";
import { riskAssessments, fmeaItems, riskMitigations } from "../../drizzle/schema/risk.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { stripClientOwnedFields } from "../../utils/crudFactory.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";

/**
 * Same inline-guard style as inventory/erp/rma/workOrders.controller.ts's
 * assertDepartment — the department-access matrix's "risk" entry grants a
 * shared floor (create + propose-mitigation) to five departments; the real
 * per-action asymmetry the Risk Management spec calls for is narrower than
 * that matrix can express, so it's enforced here instead.
 */
function assertDepartment(req: Request, allowed: string[]) {
  const role = req.user?.roleName;
  if (role === "admin" || role === "platform_admin") return;
  const department = req.user?.department;
  if (!department || !allowed.includes(department)) {
    throw AppError.forbidden(`This action requires department: ${allowed.join(" or ")}`);
  }
}

/** Admin-only, not a department at all — same convention as platform-admin-gated routes, just scoped to a single tenant-level action instead of a whole router. */
function assertAdmin(req: Request) {
  const role = req.user?.roleName;
  if (role !== "admin" && role !== "platform_admin") {
    throw AppError.forbidden("Only an admin can delete a risk.");
  }
}

/** Standard 5x5 risk-matrix bands over a 1-25 severity x probability score. */
export function computeRiskLevel(score: number | null | undefined): string | null {
  if (score === null || score === undefined) return null;
  if (score >= 16) return "critical";
  if (score >= 10) return "high";
  if (score >= 5) return "medium";
  return "low";
}

function computeScoring(severity: unknown, probability: unknown) {
  const sev = typeof severity === "number" ? severity : undefined;
  const prob = typeof probability === "number" ? probability : undefined;
  const riskScore = sev !== undefined && prob !== undefined ? sev * prob : undefined;
  const riskLevel = riskScore !== undefined ? computeRiskLevel(riskScore) : undefined;
  return { riskScore, riskLevel };
}

/**
 * Fully bespoke handlers (not crudFactory) — same reasoning as
 * workOrders.controller.ts: this module needs per-action department gating
 * (create vs. update vs. close vs. delete each allow a different set of
 * departments), workflow-transition validation, and computed
 * riskScore/riskLevel, none of which the generic factory can express.
 */
export const listRisksHandler = asyncHandler(async (req: Request, res: Response) => {
  const { status, department } = req.query as Record<string, string | undefined>;
  const conditions = [eq(riskAssessments.tenantId, req.tenantId!)];
  if (status) conditions.push(eq(riskAssessments.status, status));
  if (department) conditions.push(eq(riskAssessments.department, department));

  const rows = await req.db!.select().from(riskAssessments).where(and(...conditions)).orderBy(desc(riskAssessments.createdAt));
  res.json(rows);
});

async function loadRisk(req: Request, id: number) {
  const [row] = await req.db!.select().from(riskAssessments).where(and(eq(riskAssessments.id, id), eq(riskAssessments.tenantId, req.tenantId!)));
  if (!row) throw AppError.notFound("Risk assessment");
  return row;
}

const ALLOWED_NEXT: Record<string, string> = {
  open: "mitigation",
  mitigation: "monitoring",
  monitoring: "closed",
};

async function transition(req: Request, id: number, newStatus: string) {
  const record = await loadRisk(req, id);
  if (ALLOWED_NEXT[record.status] !== newStatus) {
    throw AppError.badRequest(`Cannot move a risk from "${record.status}" to "${newStatus}" — workflow is open -> mitigation -> monitoring -> closed.`);
  }
  const [updated] = await req
    .db!.update(riskAssessments)
    .set({ status: newStatus, updatedAt: new Date(), ...(newStatus === "closed" ? { closedAt: new Date() } : {}) })
    .where(eq(riskAssessments.id, record.id))
    .returning();
  await recordAuditTrail(req.db!, {
    tenantId: req.tenantId!,
    entityType: "RiskAssessment",
    entityId: record.id,
    action: "status_change",
    changes: { oldStatus: record.status, newStatus },
    performedBy: req.user?.id,
  });
  await publishEvent(WORKFLOW_STREAM, { tenantId: req.tenantId!, module: "risk", event: newStatus, entityId: record.id });
  return updated!;
}

/**
 * Create — any of the risk-matrix's five departments may raise a risk
 * (quality/engineering/production/purchasing/material_management), matching
 * the module's real integration points (NCR, Supplier, Receiving, Work
 * Orders are each owned by a different one of these). `sourceType`/
 * `sourceId` are trusted as given — a real per-type existence check would
 * need a lookup against four different tables for one optional field; the
 * source record itself is what renders the "Create Risk" button in the
 * first place, so a bad id here would mean a real UI bug, not user input to
 * defend against the way a hand-typed "linked NCR id" elsewhere in the app
 * is.
 */
export const createRiskHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["quality", "engineering", "production", "purchasing", "material_management"]);
  const { riskScore, riskLevel } = computeScoring(req.body.severity, req.body.probability);

  const [created] = await req
    .db!.insert(riskAssessments)
    .values({ ...req.body, riskScore, riskLevel, tenantId: req.tenantId!, createdBy: req.user?.id })
    .returning();
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "RiskAssessment", entityId: created!.id, action: "create", changes: req.body, performedBy: req.user?.id });
  res.status(201).json(created);
});

export const getRiskHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadRisk(req, Number(req.params.id));
  const mitigations = await req.db!.select().from(riskMitigations).where(and(eq(riskMitigations.riskAssessmentId, record.id), eq(riskMitigations.tenantId, req.tenantId!)));
  const fmea = await req.db!.select().from(fmeaItems).where(and(eq(fmeaItems.riskAssessmentId, record.id), eq(fmeaItems.tenantId, req.tenantId!)));
  res.json({ ...record, mitigations, fmeaItems: fmea });
});

/**
 * Update — Quality (full control) and Engineering ("update technical
 * fields" per the spec) only; Production/Purchasing/Material Management can
 * still create a risk and propose mitigations, but not edit the risk record
 * itself. Never accepts `status` (see updateRiskSchema's own comment) — a
 * severity/probability change gets its own flagged audit entry per the
 * spec's explicit "severity/probability change" audit requirement, distinct
 * from a plain field edit.
 */
export const updateRiskHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["quality", "engineering"]);
  const record = await loadRisk(req, Number(req.params.id));
  // Not a real column — a client that just applied an AI suggestion (see
  // risk.ai.ts) passes the suggestion's id back here so the audit entry
  // below can say "AI suggestion accepted" instead of a plain field edit,
  // per the spec's explicit requirement to log that distinctly. Stripped
  // before the DB write either way.
  const { aiSuggestionId, ...rest } = req.body as { aiSuggestionId?: number } & Record<string, unknown>;
  const body = stripClientOwnedFields(rest) as { severity?: number; probability?: number } & Record<string, unknown>;
  const scoringChanged = body.severity !== undefined || body.probability !== undefined;
  const { riskScore, riskLevel } = computeScoring(body.severity ?? record.severity, body.probability ?? record.probability);

  const [updated] = await req
    .db!.update(riskAssessments)
    .set({ ...body, ...(scoringChanged ? { riskScore, riskLevel } : {}), updatedAt: new Date() })
    .where(eq(riskAssessments.id, record.id))
    .returning();

  await recordAuditTrail(req.db!, {
    tenantId: req.tenantId!,
    entityType: "RiskAssessment",
    entityId: record.id,
    action: "update",
    changes: aiSuggestionId
      ? { subAction: "ai_suggestion_accepted", suggestionId: aiSuggestionId, fieldsChanged: Object.keys(body), ...body }
      : scoringChanged
        ? { subAction: "severity_probability_change", fieldsChanged: Object.keys(body), oldSeverity: record.severity, oldProbability: record.probability, newSeverity: updated!.severity, newProbability: updated!.probability, newRiskScore: riskScore, newRiskLevel: riskLevel }
        : { fieldsChanged: Object.keys(body), ...body },
    performedBy: req.user?.id,
  });
  res.json(updated);
});

/** open -> mitigation. Quality only ("full control" of the workflow per the spec — Engineering/Production/Purchasing propose mitigation actions, they don't drive the parent risk's own status). */
export const startMitigationHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["quality"]);
  res.json(await transition(req, Number(req.params.id), "mitigation"));
});

/** mitigation -> monitoring. Quality only, same reasoning as above. */
export const startMonitoringHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["quality"]);
  res.json(await transition(req, Number(req.params.id), "monitoring"));
});

/** monitoring -> closed. Quality only. */
export const closeRiskHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["quality"]);
  res.json(await transition(req, Number(req.params.id), "closed"));
});

/**
 * Delete — admin only (tenant-level admin or platform_admin), never a
 * department. Hard delete (matches crudFactory's default, and this table
 * has no `isDeleted` column) — mitigations and FMEA items are deleted first
 * to satisfy their FK constraints, all inside the same request transaction,
 * all logged.
 */
export const deleteRiskHandler = asyncHandler(async (req: Request, res: Response) => {
  assertAdmin(req);
  const record = await loadRisk(req, Number(req.params.id));

  await req.db!.delete(riskMitigations).where(and(eq(riskMitigations.riskAssessmentId, record.id), eq(riskMitigations.tenantId, req.tenantId!)));
  await req.db!.delete(fmeaItems).where(and(eq(fmeaItems.riskAssessmentId, record.id), eq(fmeaItems.tenantId, req.tenantId!)));
  await req.db!.delete(riskAssessments).where(and(eq(riskAssessments.id, record.id), eq(riskAssessments.tenantId, req.tenantId!)));

  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "RiskAssessment", entityId: record.id, action: "delete", changes: { title: record.title, status: record.status }, performedBy: req.user?.id });
  res.status(204).send();
});

export const addFmeaItemHandler = asyncHandler(async (req: Request, res: Response) => {
  const risk = await loadRisk(req, Number(req.params.id));
  const { severity, occurrence, detection } = req.body;
  const rpn = severity * occurrence * detection;

  const [item] = await req
    .db!.insert(fmeaItems)
    .values({ ...req.body, riskAssessmentId: risk.id, tenantId: req.tenantId!, rpn: String(rpn) })
    .returning();
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "RiskAssessment", entityId: risk.id, action: "update", changes: { action: "fmea_item_added", failureMode: item!.failureMode, rpn }, performedBy: req.user?.id });
  res.status(201).json(item);
});

export const listFmeaItemsHandler = asyncHandler(async (req: Request, res: Response) => {
  const items = await req
    .db!.select()
    .from(fmeaItems)
    .where(and(eq(fmeaItems.riskAssessmentId, Number(req.params.id)), eq(fmeaItems.tenantId, req.tenantId!)));
  res.json(items);
});

/** Propose a mitigation action — any of the risk-matrix's five departments (each "proposes" per the spec; Quality still separately drives the parent risk's own status transitions above). */
export const createMitigationHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["quality", "engineering", "production", "purchasing", "material_management"]);
  const risk = await loadRisk(req, Number(req.params.id));
  const { aiSuggestionId, ...body } = req.body as { aiSuggestionId?: number; action: string; dueDate?: Date; ownerId?: number };

  const [created] = await req
    .db!.insert(riskMitigations)
    .values({ ...body, riskAssessmentId: risk.id, tenantId: req.tenantId!, createdBy: req.user?.id })
    .returning();
  await recordAuditTrail(req.db!, {
    tenantId: req.tenantId!,
    entityType: "RiskMitigation",
    entityId: created!.id,
    action: "create",
    changes: aiSuggestionId ? { subAction: "ai_suggestion_accepted", suggestionId: aiSuggestionId, riskAssessmentId: risk.id, ...body } : { riskAssessmentId: risk.id, ...body },
    performedBy: req.user?.id,
  });
  res.status(201).json(created);
});

export const updateMitigationHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["quality", "engineering", "production", "purchasing", "material_management"]);
  const riskId = Number(req.params.id);
  const mitigationId = Number(req.params.mid);
  const [existing] = await req.db!.select().from(riskMitigations).where(and(eq(riskMitigations.id, mitigationId), eq(riskMitigations.riskAssessmentId, riskId), eq(riskMitigations.tenantId, req.tenantId!)));
  if (!existing) throw AppError.notFound("Risk mitigation");

  const [updated] = await req
    .db!.update(riskMitigations)
    .set({ ...stripClientOwnedFields(req.body), updatedAt: new Date() })
    .where(eq(riskMitigations.id, mitigationId))
    .returning();
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "RiskMitigation", entityId: mitigationId, action: "update", changes: req.body, performedBy: req.user?.id });
  res.json(updated);
});
