import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { ERP_PRESET_MODULES } from "../../drizzle/schema/erpPresets.js";
import * as erpPresets from "./erpPresets.service.js";

export const listPresetsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { vendor, module } = req.query as { vendor?: string; module?: string };
  res.json(await erpPresets.listPresets(req.db!, { vendor, module }));
});

export const getPresetHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await erpPresets.getPreset(req.db!, Number(req.params.id)));
});

export const createPresetHandler = asyncHandler(async (req: Request, res: Response) => {
  const created = await erpPresets.createPreset(req.db!, req.body, req.user?.id);
  res.status(201).json(created);
});

/** POST /erp/presets/:id/clone — "Customize" in the list UI: clones a global (or another visible) preset into a real, editable tenant-owned copy. */
export const clonePresetHandler = asyncHandler(async (req: Request, res: Response) => {
  const cloned = await erpPresets.clonePreset(req.db!, Number(req.params.id), req.user?.id);
  res.status(201).json(cloned);
});

export const updatePresetHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await erpPresets.updatePreset(req.db!, Number(req.params.id), req.body, req.user?.id));
});

export const deletePresetHandler = asyncHandler(async (req: Request, res: Response) => {
  await erpPresets.softDeletePreset(req.db!, Number(req.params.id), req.user?.id);
  res.status(204).send();
});

export const activatePresetHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await erpPresets.activatePreset(req.db!, Number(req.params.id), req.user?.id));
});

export const getActivePresetHandler = asyncHandler(async (req: Request, res: Response) => {
  const module = req.params.module as string;
  if (!ERP_PRESET_MODULES.includes(module as (typeof ERP_PRESET_MODULES)[number])) {
    throw AppError.badRequest(`Unknown module "${module}"`);
  }
  const active = await erpPresets.getActivePreset(req.db!, module);
  res.json(active);
});
