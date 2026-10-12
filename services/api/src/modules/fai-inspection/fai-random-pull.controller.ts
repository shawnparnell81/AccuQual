import { AppError } from "../../utils/appError.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { updateRulesSchema, generateBatchSchema, approveBatchSchema, linkItemSchema } from "./fai-random-pull.validation.js";
import * as svc from "./fai-random-pull.service.js";

function idOf(value: string | undefined, label: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw AppError.badRequest(`Choose a valid ${label}.`);
  return id;
}

export const getRules = asyncHandler(async (req, res) => {
  res.json(await svc.getRules(req.db!, req.user));
});
export const updateRules = asyncHandler(async (req, res) => {
  const body = updateRulesSchema.parse(req.body);
  res.json(await svc.updateRules(req.db!, req.user, body));
});

export const generateBatch = asyncHandler(async (req, res) => {
  const body = generateBatchSchema.parse(req.body ?? {});
  res.status(201).json(await svc.generateBatch(req.db!, req.user, body));
});
export const listBatches = asyncHandler(async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : undefined;
  res.json(await svc.listBatches(req.db!, req.user, year));
});
export const getBatch = asyncHandler(async (req, res) => {
  res.json(await svc.getBatch(req.db!, req.user, idOf(req.params.id, "random-pull batch")));
});
export const approveBatch = asyncHandler(async (req, res) => {
  const body = approveBatchSchema.parse(req.body);
  res.json(await svc.approveBatch(req.db!, req.user, req, idOf(req.params.id, "random-pull batch"), body));
});

export const linkItem = asyncHandler(async (req, res) => {
  const body = linkItemSchema.parse(req.body);
  res.json(await svc.linkItemToRecord(req.db!, req.user, idOf(req.params.id, "random-pull item"), body.recordId));
});

export const compliance = asyncHandler(async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
  res.json(await svc.compliance(req.db!, req.user, year));
});
