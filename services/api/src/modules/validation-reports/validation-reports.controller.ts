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

const SIGNATURE_COPY: Record<string, Record<string, string>> = {
  air_strut: { authorizedSignature: "I certify that this air strut validation is accurate and I authorize the disposition." },
  air_spring: { authorizedSignature: "I certify that this air spring validation is accurate and I authorize the disposition." },
  fuel_injector: {
    authorizedSignature: "I certify that this fuel injector validation is accurate and I authorize the disposition.",
    furtherSignature: "I certify that the further review of this fuel injector is accurate and I authorize the later disposition.",
  },
  brake_wear: {
    authorizedSignature: "I certify that this brake wear sensor validation is accurate and I authorize the disposition.",
    furtherSignature: "I certify that the further review of this brake wear sensor is accurate and I authorize the later disposition.",
  },
  air_compressor: { authorizedSignature: "I certify that this air compressor validation is accurate and I authorize the disposition." },
  electric_lift: { authorizedSignature: "I certify that this electric lift support validation is accurate and I authorize the disposition." },
  gas_lift: {
    authorizedSignature: "I certify that this gas lift support validation is accurate and I authorize the disposition.",
    furtherSignature: "I certify that the further review of this gas lift support is accurate and I authorize the later disposition.",
  },
  coil_spring: { authorizedSignature: "I certify that this coil spring validation is accurate and I authorize the disposition." },
};

export const signValidationReport = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const field = req.body.field === "furtherSignature" ? "furtherSignature" : "authorizedSignature";
  const [record] = await req.db!.select().from(validationReports).where(eq(validationReports.id, id));
  if (!record) throw AppError.notFound("Validation Report");
  const description = SIGNATURE_COPY[validationKind(record.data)]?.[field];
  if (!description) throw AppError.badRequest("This validation report has no signature block.");
  const previous = asRecord(record.data);
  const current = previous[field];
  if (typeof current === "string" && current.trim()) throw AppError.badRequest("This signature is already recorded.");
  const stamp = await requireSignatureStamp(req, {
    pin: req.body.pin,
    certified: req.body.certified,
    entityType: "Validation Report",
    entityId: id,
    field,
    description,
  });
  const next = { ...previous, [field]: stamp.stamp };
  const [updated] = await req.db!.update(validationReports).set({ data: next, updatedAt: new Date() }).where(eq(validationReports.id, id)).returning();
  res.json(updated);
});
