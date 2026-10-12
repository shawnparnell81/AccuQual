import { asyncHandler } from "../../utils/asyncHandler.js";
import * as svc from "./fai-charts.service.js";

function siteIdOf(req: any): number | null {
  return (req as any).siteId ?? (req as any).site?.id ?? null;
}

export const passRateByMonth = asyncHandler(async (req, res) => {
  res.json(await svc.passRateByMonth(req.db!, req.user, siteIdOf(req)));
});
export const byTriggerReason = asyncHandler(async (req, res) => {
  res.json(await svc.byTriggerReason(req.db!, req.user, siteIdOf(req)));
});
export const failuresBySupplier = asyncHandler(async (req, res) => {
  res.json(await svc.failuresBySupplier(req.db!, req.user, siteIdOf(req)));
});
export const agingOfOpenFais = asyncHandler(async (req, res) => {
  res.json(await svc.agingOfOpenFais(req.db!, req.user, siteIdOf(req)));
});
