import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { fuelPumpFaiRecords } from "../../drizzle/schema/fuelPumpFai.js";
import { copyFuelPump, getFuelPump, listFuelPump, listPreviousFuelPump, saveFuelPumpResults, submitFuelPump } from "./fuelPumpFai.service.js";
import { renderFuelPumpPdf } from "./fuelPumpFai.pdf.js";
import { applyChrome, loadPdfChrome, persistPdfExport } from "../pdf-exports/pdfExportStore.js";
import { emptyFrame } from "../forms/controlledPdf.js";
import { readFpm } from "./fuelPumpFai.logic.js";

export const listFuelPumpHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await listFuelPump(req.db!));
});

export const listPreviousFuelPumpHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await listPreviousFuelPump(req.db!, String(req.query.partNumber ?? "")));
});

export const copyFuelPumpHandler = asyncHandler(async (req: Request, res: Response) => {
  const sourceId = Number(req.body?.sourceId);
  if (!Number.isInteger(sourceId) || sourceId < 1) throw AppError.badRequest("Choose a record to copy.");
  const created = await copyFuelPump(req.db!, { id: req.user!.id, roleName: req.user?.roleName ?? null }, sourceId, req.siteId ?? null);
  res.status(201).json(created);
});

export const submitFuelPumpHandler = asyncHandler(async (req: Request, res: Response) => {
  const created = await submitFuelPump(req.db!, { id: req.user!.id, roleName: req.user?.roleName ?? null }, req.body as Record<string, unknown>, req.siteId ?? null);
  res.status(201).json(created);
});

export const getFuelPumpHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await getFuelPump(req.db!, Number(req.params.id)));
});

export const saveFuelPumpResultsHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { branch?: string; entries?: unknown };
  res.json(await saveFuelPumpResults(req.db!, Number(req.params.id), String(body.branch ?? ""), Array.isArray(body.entries) ? body.entries : []));
});

export const fuelPumpPdfHandler = asyncHandler(async (req: Request, res: Response) => {
  const [row] = await req.db!.select().from(fuelPumpFaiRecords).where(eq(fuelPumpFaiRecords.id, Number(req.params.id)));
  if (!row) {
    res.status(404).json({ error: "Fuel pump first article not found" });
    return;
  }
  const state = readFpm((row.packet ?? {}) as Record<string, unknown>);
  if (!state.report && state.status !== "Closed" && state.status !== "Approved") {
    res.status(409).json({ error: "The final fuel pump FAI report is generated when the module is released." });
    return;
  }
  const id = Number(req.params.id);
  const chrome = await loadPdfChrome(req.db!, "fuel_pump_fai", id, state);
  const pdf = await renderFuelPumpPdf(state, chrome);
  const frame = applyChrome(emptyFrame({
    sourceModule: "Fuel Pump First Article",
    recordNumber: state.number,
    revision: "",
    generatedBy: state.inspector || "AccuQual",
    status: state.status,
  }), chrome);
  await persistPdfExport(req.db!, pdf, frame, { entityType: "fuel_pump_fai", entityId: id, actorId: req.user?.id });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("X-Export-Id", chrome.exportId);
  res.setHeader("Content-Disposition", `attachment; filename="${state.number}.pdf"`);
  res.send(Buffer.from(pdf));
});
