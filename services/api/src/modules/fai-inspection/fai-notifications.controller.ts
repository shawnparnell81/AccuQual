import { AppError } from "../../utils/appError.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { distributionListSchema, updateDistributionListSchema } from "./fai-notifications.validation.js";
import * as svc from "./fai-notifications.service.js";

function idOf(value: string | undefined, label: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw AppError.badRequest(`Choose a valid ${label}.`);
  return id;
}

export const listDistributionLists = asyncHandler(async (req, res) => {
  res.json(await svc.listDistributionLists(req.db!, req.user));
});
export const createDistributionList = asyncHandler(async (req, res) => {
  const body = distributionListSchema.parse(req.body);
  res.status(201).json(await svc.createDistributionList(req.db!, req.user, body));
});
export const updateDistributionList = asyncHandler(async (req, res) => {
  const body = updateDistributionListSchema.parse(req.body);
  res.json(await svc.updateDistributionList(req.db!, req.user, idOf(req.params.id, "distribution list"), body));
});
export const deleteDistributionList = asyncHandler(async (req, res) => {
  res.json(await svc.deleteDistributionList(req.db!, req.user, idOf(req.params.id, "distribution list")));
});
