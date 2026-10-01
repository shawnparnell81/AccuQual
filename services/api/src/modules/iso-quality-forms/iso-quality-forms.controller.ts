import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { isoQualityForms } from "../../drizzle/schema/isoQualityForms.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { snapshotIsoFormNumber } from "../document-folders/formRecordFiling.js";
import { answersWithTemplateStamp } from "../forms/templateRevision.js";
import { retainSignatureValues } from "../signatures/signaturePin.js";
import { requireSignatureStamp } from "../signatures/signaturePin.service.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { assertEcrAnswerEdit, blankEcrWorkflow, canApproveChangeRequest, readEcrWorkflow } from "../change-requests/changeRequestWorkflow.js";
import { stampNewEcr } from "../change-requests/ecr.controller.js";
import { syncQuarantineNotice } from "../quarantine/quarantineNotice.js";

const AUDIT_SIGNATURES: Record<string, string> = {
  leadAuditorSignature: "I certify that I conducted this audit impartially and according to the internal audit procedure.",
  managementSignature: "I certify that I have reviewed the findings, scores, and triggered corrective actions.",
  auditeeSignature1: "I certify that the immediate correction for this minor finding is complete.",
  auditeeSignature2: "I certify that the immediate correction for this minor finding is complete.",
  auditeeSignature3: "I certify that the immediate correction for this minor finding is complete.",
  auditeeSignature4: "I certify that the immediate correction for this minor finding is complete.",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export const baseHandlers = crudFactory(isoQualityForms, {
  entityName: "ISO form",
  idColumn: "id",
  prepareCreate: (body) => {
    const data = answersWithTemplateStamp(`iso:${String(body.formType ?? "")}`, undefined, asRecord(body.data), true);
    if (body.formType === "engineering_change") return { ...body, data: { ...data, workflow: blankEcrWorkflow() } };
    return { ...body, data };
  },
  mergeUpdate: (existing, patch) => {
    if (!patch.data || typeof patch.data !== "object" || Array.isArray(patch.data)) return patch;
    if (existing.formType === "engineering_change") assertEcrAnswerEdit(existing.data, patch.data);
    const previous = asRecord(existing.data);
    const stamped = answersWithTemplateStamp(`iso:${String(existing.formType ?? "")}`, existing.data, patch.data as Record<string, unknown>, false);
    return { ...patch, data: retainSignatureValues(previous, stamped) };
  },
  afterCreate: async (created, req) => {
    if (!req.db) return;
    await snapshotIsoFormNumber(req.db, created);
    await stampNewEcr(req.db, created);
    if (created.formType === "quarantine_notice") {
      await syncQuarantineNotice(req.db, Number(created.id), created.data, req.user?.id);
    }
  },
  afterUpdate: async (updated, req) => {
    if (!req.db || updated.formType !== "quarantine_notice") return;
    await syncQuarantineNotice(req.db, Number(updated.id), updated.data, req.user?.id);
  },
});

const FORM_SIGNATURES: Record<string, Record<string, string>> = {
  audit_summary: AUDIT_SIGNATURES,
  salt_spray: {
    testedSignature: "I certify that I performed this salt spray test and the record is accurate.",
    approvedSignature: "I certify that I approve this salt spray test report.",
  },
  prototype_strut: {
    engineeringSignoffSignature: "I certify that I approve this prototype evaluation.",
  },
  scar_request: {
    managerSignature: "I certify that I verified this supplier corrective action request.",
  },
  engineering_change: {
    managerSignature: "I certify that I approve this engineering change request.",
    supplierRepSignature: "I certify that I represent the supplier on this engineering change request.",
  },
};

export const signIsoQualityForm = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const field = String(req.body.field ?? "");
  const [record] = await req.db!.select().from(isoQualityForms).where(eq(isoQualityForms.id, id));
  if (!record) throw AppError.notFound("ISO form");
  const description = FORM_SIGNATURES[record.formType]?.[field];
  if (!description) throw AppError.badRequest("That signature field is not recognized.");
  if (record.formType === "engineering_change") {
    const status = readEcrWorkflow(record.data).status;
    if (status === "closed") throw AppError.badRequest("This engineering change request is closed.");
    if (field === "managerSignature" && status !== "request" && status !== "review") {
      throw AppError.badRequest("The manager signature is recorded during request or review.");
    }
    if (field === "managerSignature" && !canApproveChangeRequest(req.user)) {
      throw AppError.forbidden("That signature is limited to quality and engineering management.");
    }
  }
  const previous = asRecord(record.data);
  const current = previous[field];
  if (typeof current === "string" && current.trim()) throw AppError.badRequest("This signature is already recorded.");
  const stamp = await requireSignatureStamp(req, {
    pin: req.body.pin,
    certified: req.body.certified,
    entityType: "ISO form",
    entityId: id,
    field,
    description,
  });
  const next = { ...previous, [field]: stamp.stamp };
  const [updated] = await req.db!.update(isoQualityForms).set({ data: next, updatedAt: new Date() }).where(eq(isoQualityForms.id, id)).returning();
  res.json(updated);
});
