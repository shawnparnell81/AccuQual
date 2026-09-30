import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { validationReports } from "../../drizzle/schema/validationReport.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { validationFormKeyFor, validationKind } from "../document-folders/editableForms.js";
import { snapshotFormNumber } from "../document-folders/formRecordFiling.js";
import { answersWithTemplateStamp } from "../forms/templateRevision.js";
import { retainSignatureValues } from "../signatures/signaturePin.js";
import { requireSignatureStamp } from "../signatures/signaturePin.service.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export const baseHandlers = crudFactory(validationReports, {
  entityName: "Validation Report",
  idColumn: "id",
  prepareCreate: (body) => {
    const incoming = asRecord(body.data);
    const kind = validationKind(incoming);
    return { ...body, data: answersWithTemplateStamp(`validation:${kind}`, undefined, { ...incoming, formType: kind }, true) };
  },
  mergeUpdate: (existing, patch) => {
    if (!patch.data || typeof patch.data !== "object" || Array.isArray(patch.data)) return patch;
    const previous = asRecord(existing.data);
    const kind = validationKind(previous);
    const stamped = answersWithTemplateStamp(`validation:${kind}`, previous, { ...(patch.data as Record<string, unknown>), formType: kind }, false);
    return { ...patch, data: retainSignatureValues(previous, stamped) };
  },
  afterCreate: async (created, req) => {
    if (!req.db) return;
    const id = typeof created.id === "number" ? created.id : 0;
    await snapshotFormNumber(req.db, validationFormKeyFor(created.data), id);
  },
});

export const signValidationReport = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [record] = await req.db!.select().from(validationReports).where(eq(validationReports.id, id));
  if (!record) throw AppError.notFound("Validation Report");
  if (validationKind(record.data) !== "air_strut") throw AppError.badRequest("This validation report has no signature block.");
  const previous = asRecord(record.data);
  const current = previous.authorizedSignature;
  if (typeof current === "string" && current.trim()) throw AppError.badRequest("This signature is already recorded.");
  const stamp = await requireSignatureStamp(req, {
    pin: req.body.pin,
    certified: req.body.certified,
    entityType: "Validation Report",
    entityId: id,
    field: "authorizedSignature",
    description: "I certify that this air strut validation is accurate and I authorize the disposition.",
  });
  const next = { ...previous, authorizedSignature: stamp.stamp };
  const [updated] = await req.db!.update(validationReports).set({ data: next, updatedAt: new Date() }).where(eq(validationReports.id, id)).returning();
  res.json(updated);
});
