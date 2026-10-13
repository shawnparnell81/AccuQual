import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import {
  createPlanSchema, updatePlanSchema, createRecordSchema, updateRecordSchema,
  resultLineSchema, signRecordSchema, manualSourceStatusSchema, attachFormSchema, createSourceSchema, updateSourceSchema,
} from "./fai-inspection.validation.js";
import * as svc from "./fai-inspection.service.js";
import { recordPdf as buildPdf } from "./fai-inspection.pdf.js";

function idOf(value: string | undefined, label: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw AppError.badRequest(`Choose a valid ${label}.`);
  return id;
}

function siteIdOf(req: any): number | null {
  return (req as any).siteId ?? (req as any).site?.id ?? null;
}

/* Plans */
export const listPlans = asyncHandler(async (req, res) => {
  res.json(await svc.listPlans(req.db!, req.user, siteIdOf(req), req.query.q as string | undefined));
});
export const getPlan = asyncHandler(async (req, res) => {
  res.json(await svc.getPlan(req.db!, req.user, idOf(req.params.id, "inspection plan")));
});
export const createPlan = asyncHandler(async (req, res) => {
  const body = createPlanSchema.parse(req.body);
  res.status(201).json(await svc.createPlan(req.db!, req.user, siteIdOf(req), body));
});
export const updatePlan = asyncHandler(async (req, res) => {
  const body = updatePlanSchema.parse(req.body);
  res.json(await svc.updatePlan(req.db!, req.user, idOf(req.params.id, "inspection plan"), body));
});

/* Sources */
export const listSources = asyncHandler(async (req, res) => {
  res.json(await svc.listSources(req.db!, req.user, siteIdOf(req), req.query.status as string | undefined));
});
export const manualSourceStatus = asyncHandler(async (req, res) => {
  const body = manualSourceStatusSchema.parse(req.body);
  res.json(await svc.manualSourceStatus(req.db!, req.user, req, idOf(req.params.id, "approved source"), body));
});

export const createSource = asyncHandler(async (req, res) => {
  const body = createSourceSchema.parse(req.body);
  res.status(201).json(await svc.createSource(req.db!, req.user, siteIdOf(req), body));
});
export const updateSource = asyncHandler(async (req, res) => {
  const body = updateSourceSchema.parse(req.body);
  res.json(await svc.updateSource(req.db!, req.user, idOf(req.params.id, "approved source"), body));
});
export const deleteSource = asyncHandler(async (req, res) => {
  res.json(await svc.deleteSource(req.db!, req.user, idOf(req.params.id, "approved source")));
});

/* Records */
export const listRecords = asyncHandler(async (req, res) => {
  res.json(await svc.listRecords(req.db!, req.user, siteIdOf(req), {
    status: req.query.status as string | undefined,
    q: req.query.q as string | undefined,
  }));
});
export const getRecord = asyncHandler(async (req, res) => {
  res.json(await svc.getRecord(req.db!, req.user, idOf(req.params.id, "FAI record")));
});
export const createRecord = asyncHandler(async (req, res) => {
  const body = createRecordSchema.parse(req.body);
  res.status(201).json(await svc.createRecord(req.db!, req.user, siteIdOf(req), body));
});
export const updateRecord = asyncHandler(async (req, res) => {
  const body = updateRecordSchema.parse(req.body);
  res.json(await svc.updateRecord(req.db!, req.user, idOf(req.params.id, "FAI record"), body));
});
export const saveResultLines = asyncHandler(async (req, res) => {
  const lineSchema = resultLineSchema.extend({ id: z.number().int() });
  const lines = (req.body.lines ?? []).map((l: any) => lineSchema.parse(l));
  res.json(await svc.saveResultLines(req.db!, req.user, idOf(req.params.id, "FAI record"), lines));
});
export const deleteRecord = asyncHandler(async (req, res) => {
  res.json(await svc.deleteRecord(req.db!, req.user, idOf(req.params.id, "FAI record")));
});
export const signRecord = asyncHandler(async (req, res) => {
  const body = signRecordSchema.parse(req.body);
  res.json(await svc.signRecord(req.db!, req.user, req, idOf(req.params.id, "FAI record"), body));
});
export const submitForSignoff = asyncHandler(async (req, res) => {
  res.json(await svc.submitForSignoff(req.db!, req.user, idOf(req.params.id, "FAI record")));
});
export const createNcr = asyncHandler(async (req, res) => {
  const created = await svc.createNcrFromRecord(req.db!, req.user, req, idOf(req.params.id, "FAI record"));
  res.status(created.existing ? 200 : 201).json(created);
});
export const attachForm = asyncHandler(async (req, res) => {
  const body = attachFormSchema.parse(req.body);
  res.json(await svc.attachForm(req.db!, req.user, idOf(req.params.id, "FAI record"), body));
});
export const detachForm = asyncHandler(async (req, res) => {
  const body = attachFormSchema.parse(req.body);
  res.json(await svc.detachForm(req.db!, req.user, idOf(req.params.id, "FAI record"), body));
});
export const recordPdf = asyncHandler(async (req, res) => {
  const id = idOf(req.params.id, "FAI record");
  const file = await buildPdf(req.db!, req.user, id);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
  res.send(Buffer.from(file.bytes));
});

/* Dashboard */
export const dashboard = asyncHandler(async (req, res) => {
  res.json(await svc.dashboard(req.db!, req.user, siteIdOf(req)));
});
