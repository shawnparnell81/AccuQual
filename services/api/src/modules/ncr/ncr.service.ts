import { and, eq } from "drizzle-orm";
import { ncr } from "../../drizzle/schema/ncr.js";
import { formData } from "../../drizzle/schema/forms.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";
import { syncNcrFormData, ncrIsoDate } from "./ncr.formSync.js";
import { closureRoleLabel, closureSignatureBlocks, dispositionAdvances, missingClosureSignatures, stageColumnPatch } from "./ncr.document.js";
import { signatureRequired } from "../signatures/signatureRequired.js";
import type { Db } from "../../lib/requestDb.js";
import { assertRecordOnAllowedSite } from "../sites/siteAccess.js";
import { ncrQuarantineIsOnHold, onHoldBlockMessage } from "../quarantine/quarantine.service.js";
import { canonicalNcrStep, ncrStepLabel } from "./ncr.workflow.js";
import { missingRequiredLabels, requiredMoveError } from "../workflow/requiredFields.js";

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
  allowedSiteIds?: number[],
  extraChanges?: Record<string, unknown>
) {
  const [current] = await db.select().from(ncr).where(and(eq(ncr.id, id)));
  if (!current) throw AppError.notFound("NCR");
  assertRecordOnAllowedSite(current.siteId, allowedSiteIds, "NCR");
  const currentKey = canonicalNcrStep(current.status);
  if (expectedFrom) {
    const allowed = expectedFrom.map((status) => canonicalNcrStep(status));
    if (!allowed.includes(currentKey)) {
      const names = [...new Set(allowed.map((status) => ncrStepLabel(status)))];
      throw AppError.badRequest(`Cannot "${action}" an NCR from step "${ncrStepLabel(currentKey)}" — must be one of: ${names.join(", ")}`);
    }
  }
  const nextStatus = patch.status !== undefined ? canonicalNcrStep(String(patch.status)) : currentKey;
  const fromLabel = ncrStepLabel(currentKey);
  const toLabel = ncrStepLabel(nextStatus);

  const [updated] = await db
    .update(ncr)
    .set({ ...patch, status: nextStatus, updatedAt: new Date() })
    .where(and(eq(ncr.id, id)))
    .returning();
  if (!updated) throw AppError.notFound("NCR");
  // "NCR" — must match crudFactory's entityName for this table (ncr.controller.ts's
  // baseHandlers) exactly; a casing mismatch here previously made this
  // status-change history invisible on one side or the other of the split,
  // since workflow.controller.ts's MODULE_ENTITY_TYPES filters by exact
  // string match (Postgres text comparison is case-sensitive). See the QA
  // sweep review.
  await recordAuditTrail(db, {
    entityType: "NCR",
    entityId: id,
    action: "status_change",
    changes: {
      action,
      step: toLabel,
      ...(fromLabel === toLabel ? {} : { from: fromLabel, to: toLabel }),
      patch: { ...patch, status: nextStatus },
      ...extraChanges,
    },
    performedBy,
  });
  void publishEvent(WORKFLOW_STREAM, { module: "ncr", event: action, step: toLabel, entityId: id });
  return updated;
}

async function currentStepKey(db: Db, id: number): Promise<string> {
  const [current] = await db.select({ status: ncr.status }).from(ncr).where(eq(ncr.id, id));
  if (!current) throw AppError.notFound("NCR");
  return canonicalNcrStep(current.status);
}

// Assigning ownership isn't a lifecycle step — allowed from any status.
export const assign = (db: Db, id: number, assignedTo: number, performedBy?: number, allowedSiteIds?: number[]) =>
  patchNcr(db, id, { assignedTo }, "assigned", performedBy, undefined, allowedSiteIds);

// Phase 2 NCR unified-data-model fix: each workflow step also syncs the
// matching field on the official document (see ncr.formSync.ts) — the same
// left-pane text a quality engineer just saved now shows up in the
// PDF-style form/preview immediately, not just in the bare workflow field.
export const setContainment = async (db: Db, id: number, containment: string, performedBy?: number, allowedSiteIds?: number[]) => {
  const key = await currentStepKey(db, id);
  const advancing = key === "ncr_created";
  const updated = await patchNcr(
    db,
    id,
    { containment, status: advancing ? "contain" : key },
    "containment",
    performedBy,
    [advancing ? "ncr_created" : key],
    allowedSiteIds,
  );
  await syncNcrFormData(db, id, { containmentActionText: containment }, performedBy);
  return updated;
};

/** Root cause stays a field on the record. It is not one of the six workflow steps, and it does not move the step. */
export const setRootCause = async (db: Db, id: number, rootCause: string, performedBy?: number, allowedSiteIds?: number[]) => {
  const key = await currentStepKey(db, id);
  if (key === "ncr_created") {
    throw AppError.badRequest(`Cannot "root_cause" an NCR from step "${ncrStepLabel(key)}" — record containment first.`);
  }
  const updated = await patchNcr(db, id, { rootCause, status: key }, "root_cause", performedBy, [key], allowedSiteIds);
  await syncNcrFormData(db, id, { identifiedRootCauseSummary: rootCause }, performedBy);
  return updated;
};

function withProcessText(current: Record<string, unknown> | null | undefined, key: string, value: string): Record<string, unknown> {
  const data = current && typeof current === "object" && !Array.isArray(current) ? { ...current } : {};
  data[key] = value;
  return data;
}

/** Workflow Disposition step. Quarantine material disposition stays on POST /ncr/:id/disposition and does not move this step. */
export const setDispositionStep = async (db: Db, id: number, note: string | undefined, performedBy?: number, allowedSiteIds?: number[]) => {
  const text = note?.trim() ?? "";
  if (!text) throw requiredMoveError(["Disposition"]);
  const [current] = await db.select().from(ncr).where(eq(ncr.id, id));
  if (!current) throw AppError.notFound("NCR");
  const updated = await patchNcr(
    db,
    id,
    { status: "disposition", processData: withProcessText(current.processData, "dispositionNote", text) },
    "disposition",
    performedBy,
    ["contain"],
    allowedSiteIds,
    { note: text },
  );
  await syncNcrFormData(db, id, { dispositionNote: text }, performedBy);
  return updated;
};

/**
 * Completing quarantine disposition is one action: the material decision and the workflow step.
 * A record already at Disposition or later stays there.
 */
export const advanceToDisposition = async (db: Db, id: number, note: string, performedBy?: number, allowedSiteIds?: number[]) => {
  const [current] = await db.select().from(ncr).where(eq(ncr.id, id));
  if (!current) throw AppError.notFound("NCR");
  assertRecordOnAllowedSite(current.siteId, allowedSiteIds, "NCR");
  const text = note.trim();
  if (!dispositionAdvances(current.status, true)) return { row: current, advanced: false };
  const updated = await patchNcr(
    db,
    id,
    { status: "disposition", processData: withProcessText(current.processData, "dispositionNote", text) },
    "disposition",
    performedBy,
    undefined,
    allowedSiteIds,
    { note: text, event: "quarantine_disposition" },
  );
  await syncNcrFormData(db, id, { dispositionNote: text }, performedBy);
  return { row: updated, advanced: true };
};

export const setCorrectiveAction = async (db: Db, id: number, correctiveAction: string, performedBy?: number, allowedSiteIds?: number[]) => {
  const key = await currentStepKey(db, id);
  const advancing = key === "disposition";
  if (!advancing && key !== "fix" && key !== "verify" && key !== "closed") {
    throw AppError.badRequest(`Cannot "fix" an NCR from step "${ncrStepLabel(key)}" — must be one of: Disposition`);
  }
  const updated = await patchNcr(
    db,
    id,
    { correctiveAction, status: advancing ? "fix" : key },
    advancing ? "fix" : "corrective_action",
    performedBy,
    [advancing ? "disposition" : key],
    allowedSiteIds,
  );
  await syncNcrFormData(db, id, { correctiveActionText: correctiveAction }, performedBy);
  return updated;
};

export const setVerify = async (db: Db, id: number, verification: string, performedBy?: number, allowedSiteIds?: number[]) => {
  const text = verification.trim();
  const [current] = await db.select().from(ncr).where(eq(ncr.id, id));
  if (!current) throw AppError.notFound("NCR");
  const updated = await patchNcr(
    db,
    id,
    { status: "verify", processData: withProcessText(current.processData, "verification", text) },
    "verify",
    performedBy,
    ["fix"],
    allowedSiteIds,
    { verification: text, note: text },
  );
  await syncNcrFormData(db, id, { verificationText: text }, performedBy);
  return updated;
};

export const close = async (db: Db, id: number, performedBy?: number, allowedSiteIds?: number[]) => {
  if (await ncrQuarantineIsOnHold(db, id)) throw AppError.badRequest(onHoldBlockMessage(id));
  const [current] = await db.select().from(ncr).where(eq(ncr.id, id));
  if (!current) throw AppError.notFound("NCR");
  assertRecordOnAllowedSite(current.siteId, allowedSiteIds, "NCR");
  if (canonicalNcrStep(current.status) === "verify") {
    const missing = missingRequiredLabels(["containment", "root_cause", "corrective_action"], {
      containment: current.containment,
      root_cause: current.rootCause,
      corrective_action: current.correctiveAction,
    });
    if (missing.length > 0) throw requiredMoveError(missing);
  }
  const [form] = await db
    .select({ data: formData.data })
    .from(formData)
    .where(and(eq(formData.formType, "ncr"), eq(formData.entityId, id)));
  const document = (form?.data ?? {}) as Record<string, unknown>;
  const blocks = closureSignatureBlocks();
  const unsigned = missingClosureSignatures(document);
  if (unsigned.length > 0) {
    throw AppError.badRequest(`Sign these before closing: ${unsigned.map((item) => item.label).join(", ")}`);
  }
  const signedRoles = blocks.filter((block) => signatureRequired(document, block.path, blocks)).map((block) => closureRoleLabel(block.label));
  const updated = await patchNcr(db, id, { status: "closed", closedAt: new Date() }, "closed", performedBy, ["verify"], allowedSiteIds, {
    closureSignatures: signedRoles,
  });
  await syncNcrFormData(db, id, { documentStatus: "Closed", ncrClosureDate: ncrIsoDate(updated.closedAt ?? new Date()), finalDispositionConfirmed: "Yes" }, performedBy);
  return updated;
};

/** A save of the NCR document writes the shared stage fields back onto the record. Status stays on the workflow actions. */
export async function syncDocumentToRecord(db: Db, id: number, document: Record<string, unknown>, performedBy?: number): Promise<void> {
  const [current] = await db.select().from(ncr).where(eq(ncr.id, id));
  if (!current) return;
  const patch = stageColumnPatch(current, document);
  if (!patch) return;
  await db.update(ncr).set({ ...patch, updatedAt: new Date() }).where(eq(ncr.id, id));
  await recordAuditTrail(db, {
    entityType: "NCR",
    entityId: id,
    action: "update",
    changes: { event: "document_sync", ...patch },
    performedBy,
  });
}
