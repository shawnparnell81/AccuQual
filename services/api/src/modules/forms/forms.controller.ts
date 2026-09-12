import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import * as formsService from "./forms.service.js";

export const getTemplate = asyncHandler(async (req: Request, res: Response) => {
  const template = await formsService.loadTemplate(req.db!, req.tenantId!, req.params.type!);
  res.json(template);
});

export const getForm = asyncHandler(async (req: Request, res: Response) => {
  const entityId = req.params.id ? Number(req.params.id) : undefined;
  const form = await formsService.loadData(req.db!, req.tenantId!, req.params.type!, entityId);
  res.json(form);
});

export const saveForm = asyncHandler(async (req: Request, res: Response) => {
  const entityId = req.params.id ? Number(req.params.id) : undefined;
  const saved = await formsService.saveData(req.db!, req.tenantId!, {
    formType: req.params.type!,
    entityType: req.body.entityType,
    entityId: req.body.entityId ?? entityId,
    data: req.body.data,
    userId: req.user?.id,
  });
  res.json(saved);
});

// `:id` is the entity id (the NCR/CAPA/... row this form is attached to) across
// every route in this module, matching what a frontend "Open Form" button has
// on hand — not form_data's own internal id. These two resolve it first.

export const createVersion = asyncHandler(async (req: Request, res: Response) => {
  const current = await formsService.loadData(req.db!, req.tenantId!, req.params.type!, Number(req.params.id));
  if (!current) throw AppError.notFound("Form");
  const updated = await formsService.createVersion(req.db!, req.tenantId!, current.id, req.user?.id);
  res.json(updated);
});

export const getHistory = asyncHandler(async (req: Request, res: Response) => {
  const current = await formsService.loadData(req.db!, req.tenantId!, req.params.type!, Number(req.params.id));
  if (!current) throw AppError.notFound("Form");
  res.json(await formsService.listVersions(req.db!, req.tenantId!, current.id));
});

export const exportForm = asyncHandler(async (req: Request, res: Response) => {
  const entityId = req.params.id ? Number(req.params.id) : undefined;
  const pdfBytes = await formsService.exportPdf(req.db!, req.tenantId!, req.params.type!, entityId);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${req.params.type}-${entityId ?? "form"}.pdf"`);
  res.send(Buffer.from(pdfBytes));
});
