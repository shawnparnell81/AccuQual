import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import * as erpSyncErrorsService from "./erpSyncErrors.service.js";
import type { ErpErrorType } from "../../drizzle/schema/erpSyncErrors.js";

export const listErrorsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { module, errorType, presetVersion, resolved, since, until, limit, offset } = req.query as unknown as {
    module?: string;
    errorType?: ErpErrorType;
    presetVersion?: number;
    resolved?: boolean;
    since?: Date;
    until?: Date;
    limit?: number;
    offset?: number;
  };
  const result = await erpSyncErrorsService.listErrors(req.db!, req.tenantId!, { module, errorType, presetVersion, resolved, since, until }, { limit, offset });
  res.json(result);
});

export const getErrorHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await erpSyncErrorsService.getError(req.db!, req.tenantId!, Number(req.params.id)));
});

export const resolveErrorHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await erpSyncErrorsService.resolveError(req.db!, req.tenantId!, Number(req.params.id), req.user?.id));
});

export const retryErrorHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await erpSyncErrorsService.retryError(req.db!, req.tenantId!, Number(req.params.id), req.user?.id));
});
