import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { company } from "../../drizzle/schema/company.js";
import { isoQualityForms } from "../../drizzle/schema/isoQualityForms.js";
import type { Db } from "../../lib/requestDb.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { getUserAccessLevel } from "../../middleware/departmentAccess.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { isFullAccessRole } from "../roles/roleAccess.js";
import { canEditFormStructure } from "../roles/roleHierarchy.js";
import { requireSignatureStamp, verifySignaturePin } from "../signatures/signaturePin.service.js";
import { formatUserLabel } from "../users/userDisplay.js";
import { users } from "../../drizzle/schema/users.js";
import {
  applyEcrTransition,
  blankEcrWorkflow,
  ecrActions,
  ecrApproveBlockers,
  ecrEditingMode,
  ecrHasManagerSignature,
  ecrVerificationAnswered,
  readEcrWorkflow,
  type EcrAction,
  type EcrActor,
} from "./changeRequestWorkflow.js";
import { changeRequestByFormType, changeRequestBySlug, type ChangeRequestKindDef } from "./changeRequestKinds.js";
import { labelSnapshot, loadChangeRequestMaster, nextEcrMaster, parseKindLabels, writeChangeRequestMaster } from "./ecrTemplate.js";

function actorOf(req: Request): EcrActor {
  return { roleName: req.user?.roleName, department: req.user?.department };
}

async function documentsLevel(req: Request): Promise<"none" | "read" | "edit"> {
  if (!req.user || !req.db) return "none";
  if (isFullAccessRole(req.user.roleName)) return "edit";
  return getUserAccessLevel(req.db as Db, req.user, "documents");
}

async function assertCanReadDocuments(req: Request): Promise<void> {
  if (req.user?.roleName === "supplier") throw AppError.forbidden("Supplier logins can't open this.");
  const level = await documentsLevel(req);
  if (level === "none") throw AppError.forbidden("No access to 'documents' for your department");
}

async function actorName(req: Request): Promise<string> {
  const userId = req.user?.id;
  if (!userId || !req.db) return "Unknown";
  const [person] = await req.db
    .select({ name: users.name, email: users.email, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, userId));
  return formatUserLabel(person, userId);
}

function asData(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

export async function stampNewEcr(db: Db, created: Record<string, unknown>): Promise<void> {
  const kind = changeRequestByFormType(typeof created.formType === "string" ? created.formType : undefined);
  if (!kind) return;
  const id = created.id;
  if (typeof id !== "number") return;
  const master = await loadChangeRequestMaster(db, kind);
  const data = {
    ...asData(created.data),
    workflow: blankEcrWorkflow(),
    _formTemplate: { version: master.version, revision: master.revision, structureHash: master.structureHash },
  };
  const [updated] = await db.update(isoQualityForms).set({ data, updatedAt: new Date() }).where(eq(isoQualityForms.id, id)).returning();
  if (updated) Object.assign(created, updated);
}

function publicMaster(master: Awaited<ReturnType<typeof loadChangeRequestMaster>>) {
  return {
    version: master.version,
    revision: master.revision,
    structureHash: master.structureHash,
    labels: master.labels,
    lastChange: master.lastChange,
  };
}

function kindFromRequest(req: Request): ChangeRequestKindDef {
  const kind = changeRequestBySlug(typeof req.params.kind === "string" ? req.params.kind : undefined);
  if (!kind) throw AppError.notFound("Change request template");
  return kind;
}

export const getEcrStructure = asyncHandler(async (req: Request, res: Response) => {
  await assertCanReadDocuments(req);
  res.json(publicMaster(await loadChangeRequestMaster(req.db!, kindFromRequest(req))));
});

export const unlockEcrStructure = asyncHandler(async (req: Request, res: Response) => {
  const kind = kindFromRequest(req);
  if (!canEditFormStructure(req.user)) throw AppError.forbidden("Changing a form template is limited to quality and engineering roles.");
  const [co] = await req.db!.select({ id: company.id }).from(company).limit(1);
  if (!co) throw AppError.notFound("Company");
  await requireSignatureStamp(req, {
    pin: req.body.pin,
    certified: req.body.certified,
    entityType: "Company",
    entityId: co.id,
    field: kind.profileKey,
    description: kind.structureCertify,
  });
  res.json({ unlocked: true });
});

export const saveEcrStructure = asyncHandler(async (req: Request, res: Response) => {
  const kind = kindFromRequest(req);
  if (!canEditFormStructure(req.user)) throw AppError.forbidden("Changing a form template is limited to quality and engineering roles.");
  if (req.body.certified !== true) throw AppError.badRequest("Check the certification box before signing.");
  if (typeof req.body.pin !== "string") throw AppError.badRequest("Enter a 4-digit PIN.");
  const { displayName } = await verifySignaturePin(req.user!.id, req.body.pin);
  const labels = parseKindLabels(kind, req.body.labels);
  const current = await loadChangeRequestMaster(req.db!, kind);
  const when = new Date().toISOString();
  const { master, changed } = nextEcrMaster(current, labels, null);
  if (!changed) {
    res.json(publicMaster(current));
    return;
  }
  const description = `Changed the ${kind.noun} template from Rev ${current.revision} to Rev ${master.revision}.`;
  master.lastChange = { who: displayName, what: "Template structure", when, description };
  await writeChangeRequestMaster(req.db!, kind, master);
  await recordAuditTrail(req.db!, {
    entityType: "Company",
    entityId: master.companyId,
    action: "update",
    changes: {
      action: `${kind.auditPrefix}_template`,
      summary: description,
      from: current.revision,
      to: master.revision,
      who: displayName,
      what: "Template structure",
      when,
      description,
    },
    performedBy: req.user?.id,
  });
  res.json(publicMaster(master));
});

async function loadChangeRequest(req: Request, id: number) {
  if (!Number.isInteger(id) || id < 1) throw AppError.badRequest("That record isn't recognized.");
  const [record] = await req.db!.select().from(isoQualityForms).where(eq(isoQualityForms.id, id));
  if (!record) throw AppError.notFound("ISO form");
  const kind = changeRequestByFormType(record.formType);
  if (!kind) throw AppError.badRequest("That form is not a change request.");
  return { record, kind };
}

export const getEcrWorkflow = asyncHandler(async (req: Request, res: Response) => {
  await assertCanReadDocuments(req);
  const { record, kind } = await loadChangeRequest(req, Number(req.params.id));
  const level = await documentsLevel(req);
  const master = await loadChangeRequestMaster(req.db!, kind);
  const workflow = readEcrWorkflow(record.data);
  const frozen = labelSnapshot(record.data);
  const hasManagerSignature = ecrHasManagerSignature(record.data);
  res.json({
    workflow,
    editing: ecrEditingMode(workflow.status),
    actions: ecrActions({ workflow, actor: actorOf(req), canEditRecord: level === "edit", hasManagerSignature }),
    blockers: ecrApproveBlockers(workflow, hasManagerSignature),
    labels: frozen ?? master.labels,
    labelsFrozen: frozen != null,
    revision: frozen ? (record.data as { _formTemplate?: { revision?: string } } | null)?._formTemplate?.revision || master.revision : master.revision,
    templateRevision: master.revision,
    templateVersion: master.version,
    lastChange: master.lastChange,
  });
});

export const transitionEcr = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.roleName === "supplier") throw AppError.forbidden("Supplier logins can't open this.");
  const { record, kind } = await loadChangeRequest(req, Number(req.params.id));
  const level = await documentsLevel(req);
  if (level === "none") throw AppError.forbidden("No access to 'documents' for your department");
  const action = req.body.action as EcrAction;
  const canEditRecord = level === "edit";
  const data = asData(record.data);
  const who = await actorName(req);
  const when = new Date().toISOString();
  const result = applyEcrTransition({
    workflow: readEcrWorkflow(data),
    action,
    actor: actorOf(req),
    canEditRecord,
    hasManagerSignature: ecrHasManagerSignature(data),
    verificationAnswered: ecrVerificationAnswered(data),
    note: typeof req.body.note === "string" ? req.body.note : undefined,
    now: when,
    actorName: who,
    kind,
  });
  if (action === "submit" && !labelSnapshot(data)) {
    const master = await loadChangeRequestMaster(req.db!, kind);
    data.templateLabels = master.labels;
    data._formTemplate = { version: master.version, revision: master.revision, structureHash: master.structureHash };
  }
  data.workflow = result.workflow;
  const [updated] = await req.db!.update(isoQualityForms).set({ data, updatedAt: new Date() }).where(eq(isoQualityForms.id, record.id)).returning();
  await recordAuditTrail(req.db!, {
    entityType: "ISO form",
    entityId: record.id,
    action: result.from === result.to ? "update" : "status_change",
    changes: {
      action: `${kind.auditPrefix}_${action}`,
      summary: result.summary,
      from: result.from,
      to: result.to,
      who,
      what: result.summary,
      when,
      description: result.summary,
    },
    performedBy: req.user?.id,
  });
  res.json(updated);
});
