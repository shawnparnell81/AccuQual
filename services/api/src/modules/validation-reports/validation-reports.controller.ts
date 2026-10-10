import { desc, eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { validationReports } from "../../drizzle/schema/validationReport.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { VALIDATION_NUMBER } from "../records/recordNumberSpecs.js";
import { validationFormKeyFor, validationKind } from "../document-folders/editableForms.js";
import { snapshotFormNumber } from "../document-folders/formRecordFiling.js";
import { answersWithTemplateStamp } from "../forms/templateRevision.js";
import { copyValidationCells, validationPartNumber } from "../records/copyPrevious.js";
import { renderValidationReportPdf, validationExportIdentity } from "./validationReportPdf.js";
import { applyChrome, loadPdfChrome, persistPdfExport } from "../pdf-exports/pdfExportStore.js";
import { emptyFrame } from "../forms/controlledPdf.js";
import { retainSignatureValues } from "../signatures/signaturePin.js";
import { requireSignatureStamp } from "../signatures/signaturePin.service.js";
import { diffSignatureRequired, flushSignatureRequiredAudit, rememberSignatureRequiredAudit, signatureBlocksFor, withSanitizedRequired, writeSignatureRequiredAudit } from "../signatures/signatureRequired.js";
import { stampRecordSite } from "../sites/recordSite.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export const baseHandlers = crudFactory(validationReports, {
  entityName: "Validation Report",
  idColumn: "id",
  blankCreatePath: "/validation-reports",
  recordNumber: VALIDATION_NUMBER,
  prepareCreate: (body) => {
    const incoming = asRecord(body.data);
    const kind = validationKind(incoming);
    const data = withSanitizedRequired(
      answersWithTemplateStamp(`validation:${kind}`, undefined, { ...incoming, formType: kind }, true),
      signatureBlocksFor(`validation:${kind}`),
    );
    return { ...body, data };
  },
  mergeUpdate: (existing, patch, req) => {
    if (!patch.data || typeof patch.data !== "object" || Array.isArray(patch.data)) return patch;
    const previous = asRecord(existing.data);
    const kind = validationKind(previous);
    const blocks = signatureBlocksFor(`validation:${kind}`);
    const stamped = answersWithTemplateStamp(`validation:${kind}`, previous, { ...(patch.data as Record<string, unknown>), formType: kind }, false);
    const data = withSanitizedRequired(retainSignatureValues(previous, stamped) as Record<string, unknown>, blocks);
    rememberSignatureRequiredAudit(req, diffSignatureRequired(previous, data, blocks));
    return { ...patch, data };
  },
  afterCreate: async (created, req) => {
    if (!req.db) return;
    const id = typeof created.id === "number" ? created.id : 0;
    await stampRecordSite(req.db, "validation_reports", id, req.siteId);
    await snapshotFormNumber(req.db, validationFormKeyFor(created.data), id);
    const kind = validationKind(created.data);
    const changes = diffSignatureRequired({}, created.data, signatureBlocksFor(`validation:${kind}`));
    if (changes.length > 0) {
      await writeSignatureRequiredAudit(req.db, { entityType: "Validation Report", entityId: id, performedBy: req.user?.id, changes });
    }
  },
  afterUpdate: async (updated, req) => {
    const id = typeof updated.id === "number" ? updated.id : 0;
    await flushSignatureRequiredAudit(req, "Validation Report", id);
  },
});

export const listPreviousValidation = asyncHandler(async (req: Request, res: Response) => {
  const part = String(req.query.partNumber ?? "").trim().toLowerCase();
  const formType = typeof req.query.formType === "string" ? req.query.formType : "";
  if (!part) {
    res.json([]);
    return;
  }
  const rows = await req.db!.select().from(validationReports).orderBy(desc(validationReports.id)).limit(200);
  res.json(
    rows
      .filter((row) => {
        const data = asRecord(row.data);
        const kind = validationKind(data);
        if (formType && kind !== formType) return false;
        return validationPartNumber(asRecord(data.cells)).toLowerCase() === part;
      })
      .slice(0, 40)
      .map((row) => {
        const data = asRecord(row.data);
        return { id: row.id, number: validationPartNumber(asRecord(data.cells)) || validationKind(data), status: validationKind(data), partNumber: validationPartNumber(asRecord(data.cells)) };
      }),
  );
});

export const copyValidationHandler = asyncHandler(async (req: Request, res: Response) => {
  const sourceId = Number(req.body?.sourceId);
  if (!Number.isInteger(sourceId) || sourceId < 1) throw AppError.badRequest("Choose a record to copy.");
  const [source] = await req.db!.select().from(validationReports).where(eq(validationReports.id, sourceId));
  if (!source) throw AppError.notFound("Validation Report");
  const data = asRecord(source.data);
  const kind = validationKind(data);
  const cells = copyValidationCells(kind, asRecord(data.cells));
  const next = answersWithTemplateStamp(`validation:${kind}`, undefined, { formType: kind, cells }, true);
  const [created] = await req.db!.insert(validationReports).values({ data: next as typeof validationReports.$inferInsert.data }).returning();
  if (!created) throw new AppError("The validation report could not be copied.", 500);
  await stampRecordSite(req.db!, "validation_reports", created.id, req.siteId);
  await snapshotFormNumber(req.db!, validationFormKeyFor(created.data), created.id);
  res.status(201).json(created);
});

export const validationPdfHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [row] = await req.db!.select().from(validationReports).where(eq(validationReports.id, id));
  if (!row) throw AppError.notFound("Validation Report");
  const data = { ...asRecord(row.data), recordNumber: typeof row.recordNumber === "string" ? row.recordNumber.trim() : "" };
  const chrome = await loadPdfChrome(req.db!, "validation_report", id, data);
  const bytes = await renderValidationReportPdf(data, "AccuQual", chrome);
  const identity = validationExportIdentity(data, "AccuQual");
  const frame = applyChrome(emptyFrame(identity), chrome);
  await persistPdfExport(req.db!, bytes, frame, { entityType: "validation_report", entityId: id, actorId: req.user?.id });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("X-Export-Id", chrome.exportId);
  const fileNumber = identity.recordNumber.replace(/[^a-zA-Z0-9._-]+/g, "-");
  res.setHeader("Content-Disposition", `attachment; filename="${fileNumber || "validation-report"}.pdf"`);
  res.send(Buffer.from(bytes));
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
