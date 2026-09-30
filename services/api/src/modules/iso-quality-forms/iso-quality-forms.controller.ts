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
  prepareCreate: (body) => ({
    ...body,
    data: answersWithTemplateStamp(`iso:${String(body.formType ?? "")}`, undefined, asRecord(body.data), true),
  }),
  mergeUpdate: (existing, patch) => {
    if (!patch.data || typeof patch.data !== "object" || Array.isArray(patch.data)) return patch;
    const previous = asRecord(existing.data);
    const stamped = answersWithTemplateStamp(`iso:${String(existing.formType ?? "")}`, existing.data, patch.data as Record<string, unknown>, false);
    return { ...patch, data: retainSignatureValues(previous, stamped) };
  },
  afterCreate: async (created, req) => {
    if (!req.db) return;
    await snapshotIsoFormNumber(req.db, created);
  },
});

export const signIsoQualityForm = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const field = String(req.body.field ?? "");
  const description = AUDIT_SIGNATURES[field];
  if (!description) throw AppError.badRequest("That signature field is not recognized.");
  const [record] = await req.db!.select().from(isoQualityForms).where(eq(isoQualityForms.id, id));
  if (!record) throw AppError.notFound("ISO form");
  if (record.formType !== "audit_summary") throw AppError.badRequest("This form has no signature block.");
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
