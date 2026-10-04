import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { fuelPumpFaiRecords } from "../../drizzle/schema/fuelPumpFai.js";
import { getFuelPump, listFuelPump, saveFuelPumpResults, submitFuelPump } from "./fuelPumpFai.service.js";
import { renderFuelPumpPdf } from "./fuelPumpFai.pdf.js";
import { readFpm } from "./fuelPumpFai.logic.js";

export const listFuelPumpHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await listFuelPump(req.db!));
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
  const pdf = await renderFuelPumpPdf(state);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${state.number}.pdf"`);
  res.send(Buffer.from(pdf));
});
