import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import * as fai from "./fai.service.js";

function idOf(value: string | undefined, label: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw AppError.badRequest(`Choose a valid ${label}.`);
  return id;
}

export const lookupsHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await fai.listLookups(req.db!));
});

export const queueHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await fai.buildQueue(req.db!));
});

export const listPlansHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await fai.listPlans(req.db!));
});

export const getPlanHandler = asyncHandler(async (req: Request, res: Response) => {
  const revision = req.query.revision ? Number(req.query.revision) : undefined;
  res.json(await fai.getPlan(req.db!, idOf(req.params.id, "plan"), Number.isInteger(revision) ? revision : undefined));
});

export const createPlanHandler = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json(await fai.savePlan(req.db!, req.user!.id, req.body));
});

export const updatePlanHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await fai.savePlan(req.db!, req.user!.id, req.body, idOf(req.params.id, "plan")));
});

export const retirePlanHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await fai.retirePlan(req.db!, req.user!.id, idOf(req.params.id, "plan")));
});

export const listRecordsHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await fai.listRecords(req.db!));
});

export const listPreviousRecordsHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await fai.listPreviousRecords(req.db!, String(req.query.partNumber ?? "")));
});

export const copyRecordHandler = asyncHandler(async (req: Request, res: Response) => {
  const sourceId = Number(req.body?.sourceId);
  if (!Number.isInteger(sourceId) || sourceId < 1) throw AppError.badRequest("Choose a record to copy.");
  res.status(201).json(await fai.copyRecord(req.db!, req.user!.id, sourceId));
});

export const openRecordHandler = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json(await fai.openRecord(req.db!, req.user!.id, req.body));
});

export const updateRecordNumberHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await fai.updateRecordNumber(req.db!, req.user!.id, idOf(req.params.id, "first article"), req.body.number));
});

export const getRecordHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await fai.getRecord(req.db!, idOf(req.params.id, "first article")));
});

export const saveResultsHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await fai.saveResults(req.db!, req.user!.id, idOf(req.params.id, "first article"), req.body));
});

export const assignRecordHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await fai.assignRecord(req.db!, req.user!.id, idOf(req.params.id, "first article"), req.body.userId));
});

export const submitRecordHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await fai.submitRecord(req.db!, req.user!.id, idOf(req.params.id, "first article")));
});

export const approveRecordHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await fai.approveRecord(req, idOf(req.params.id, "first article")));
});

export const rejectRecordHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await fai.rejectRecord(req, idOf(req.params.id, "first article")));
});

export const pdfHandler = asyncHandler(async (req: Request, res: Response) => {
  const file = await fai.recordPdf(req.db!, idOf(req.params.id, "first article"), req.user?.id);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("X-Export-Id", file.exportId);
  res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
  res.send(Buffer.from(file.bytes));
});

export const listSourcesHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await fai.listSources(req.db!));
});

export const listPullsHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await fai.listPulls(req.db!));
});

export const assignPullHandler = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json(await fai.assignPull(req.db!, { id: req.user!.id, roleName: req.user?.roleName ?? null, department: req.user?.department ?? null }, req.body));
});

export const completePullHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await fai.completePull(req, req.body));
});
