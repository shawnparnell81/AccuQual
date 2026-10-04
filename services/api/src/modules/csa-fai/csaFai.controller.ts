import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { copyCsa, getCsa, listCsa, listPreviousCsa, saveCsaResults, submitCsa } from "./csaFai.service.js";
import { renderCsaPdf } from "./csaFai.pdf.js";
import { applyChrome, loadPdfChrome, persistPdfExport } from "../pdf-exports/pdfExportStore.js";
import { emptyFrame } from "../forms/controlledPdf.js";
import { readCsa } from "./csaFai.logic.js";
import { csaFaiRecords } from "../../drizzle/schema/csaFai.js";
import { eq } from "drizzle-orm";

export const listCsaHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await listCsa(req.db!));
});

export const listPreviousCsaHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await listPreviousCsa(req.db!, String(req.query.partNumber ?? "")));
});

export const copyCsaHandler = asyncHandler(async (req: Request, res: Response) => {
  const sourceId = Number(req.body?.sourceId);
  if (!Number.isInteger(sourceId) || sourceId < 1) throw AppError.badRequest("Choose a record to copy.");
  const created = await copyCsa(req.db!, { id: req.user!.id, roleName: req.user?.roleName ?? null }, sourceId, req.siteId ?? null);
  res.status(201).json(created);
});

export const submitCsaHandler = asyncHandler(async (req: Request, res: Response) => {
  const created = await submitCsa(req.db!, { id: req.user!.id, roleName: req.user?.roleName ?? null }, req.body as Record<string, unknown>, req.siteId ?? null);
  res.status(201).json(created);
});

export const getCsaHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await getCsa(req.db!, Number(req.params.id)));
});

export const saveCsaResultsHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { branch?: string; entries?: unknown };
  res.json(await saveCsaResults(req.db!, Number(req.params.id), String(body.branch ?? ""), Array.isArray(body.entries) ? body.entries : []));
});

export const csaPdfHandler = asyncHandler(async (req: Request, res: Response) => {
  const [row] = await req.db!.select().from(csaFaiRecords).where(eq(csaFaiRecords.id, Number(req.params.id)));
  if (!row) {
    res.status(404).json({ error: "CSA first article not found" });
    return;
  }
  const state = readCsa((row.packet ?? {}) as Record<string, unknown>);
  if (!state.report && state.status !== "Closed" && state.status !== "Approved") {
    res.status(409).json({ error: "The final CSA FAI report is generated when the assembly is released." });
    return;
  }
  const id = Number(req.params.id);
  const chrome = await loadPdfChrome(req.db!, "csa_fai", id, state);
  const pdf = await renderCsaPdf(state, chrome);
  const frame = applyChrome(emptyFrame({
    sourceModule: "CSA First Article",
    recordNumber: state.number,
    revision: "",
    generatedBy: state.inspectorName || "AccuQual",
    status: state.status,
  }), chrome);
  await persistPdfExport(req.db!, pdf, frame, { entityType: "csa_fai", entityId: id, actorId: req.user?.id });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("X-Export-Id", chrome.exportId);
  res.setHeader("Content-Disposition", `attachment; filename="${state.number}.pdf"`);
  res.send(Buffer.from(pdf));
});
