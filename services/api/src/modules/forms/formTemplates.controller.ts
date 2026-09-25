import type { Request, Response } from "express";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { and, eq, desc } from "drizzle-orm";
import { formTemplates } from "../../drizzle/schema/forms.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { FORM_TYPES } from "./forms.validation.js";
import { loadTemplate } from "./forms.service.js";

/**
 * Tenant template upload/replace/delete — the write side of a real,
 * already-existing read path. forms.service.ts's loadTemplate() has always
 * preferred the newest form_templates row (a tenant-uploaded custom one
 * over the seeded default), and pdfPath's own schema comment already
 * documents this exact tenant-scoped storage convention — there was just
 * never an endpoint that actually created that row. Same multer +
 * STORAGE_LOCAL_PATH pattern as document-folders' uploadTemplate/
 * downloadTemplate/removeTemplate and calibration's certificate upload.
 */

/** GET /forms/templates — every real form type, with whichever template row is currently active for this tenant (custom if one exists, else the seeded default). */
export const listTemplatesHandler = asyncHandler(async (req: Request, res: Response) => {
  const rows = await req.db!.select().from(formTemplates).orderBy(desc(formTemplates.id));
  const activeByType = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!activeByType.has(row.formType)) activeByType.set(row.formType, row); // newest first, so first hit per type wins
  }

  res.json(
    FORM_TYPES.map((formType) => {
      const active = activeByType.get(formType);
      return {
        formType,
        hasTemplate: !!active,
        isDefault: active ? active.isDefault === "true" : null,
        uploadedAt: active?.createdAt ?? null,
      };
    })
  );
});

export const uploadTemplateHandler = asyncHandler(async (req: Request, res: Response) => {
  const formType = req.params.type!;
  if (!(FORM_TYPES as readonly string[]).includes(formType)) throw AppError.badRequest(`Unknown form type "${formType}"`);
  const file = req.file;
  if (!file) throw AppError.badRequest("No file uploaded");
  if (file.mimetype !== "application/pdf") throw AppError.badRequest("Only PDF files are accepted");

  // Carry over the currently-active template's field map — replacing the
  // PDF shouldn't silently blank out where every field is positioned on the
  // page (see pdf-merger.js); nothing here offers a field-mapping editor.
  const current = await loadTemplate(req.db!, formType).catch(() => null);

  const dir = `${env.STORAGE_LOCAL_PATH}/forms/${formType}`;
  await mkdir(dir, { recursive: true });
  const path = `${dir}/template-${Date.now()}.pdf`;
  await writeFile(path, file.buffer);

  const [created] = await req.db!
    .insert(formTemplates)
    .values({ formType, pdfPath: path, fieldMap: current?.fieldMap ?? {}, isDefault: "false" })
    .returning();

  await recordAuditTrail(req.db!, { entityType: "FormTemplate", entityId: created!.id, action: "update", changes: { templateType: formType, filename: file.originalname }, performedBy: req.user?.id });
  res.status(201).json({ formType, hasTemplate: true, isDefault: false, uploadedAt: created!.createdAt });
});

export const downloadTemplateHandler = asyncHandler(async (req: Request, res: Response) => {
  const template = await loadTemplate(req.db!, req.params.type!);
  if (!existsSync(template.pdfPath)) throw AppError.notFound("Template file");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${req.params.type}.pdf"`);
  createReadStream(template.pdfPath).pipe(res);
});

/** Removes the tenant's own custom template(s) for this type — the seeded default row is never deleted, so the type reverts to it automatically (loadTemplate just has nothing newer to prefer). */
export const deleteTemplateHandler = asyncHandler(async (req: Request, res: Response) => {
  const formType = req.params.type!;
  const customRows = await req.db!.select().from(formTemplates).where(and(eq(formTemplates.formType, formType), eq(formTemplates.isDefault, "false")));
  if (customRows.length === 0) throw AppError.notFound("Custom template");

  for (const row of customRows) {
    if (existsSync(row.pdfPath)) {
      await unlink(row.pdfPath).catch((err) => logger.warn(`Could not remove template file ${row.pdfPath}`, err));
    }
  }
  await req.db!.delete(formTemplates).where(and(eq(formTemplates.formType, formType), eq(formTemplates.isDefault, "false")));

  await recordAuditTrail(req.db!, { entityType: "FormTemplate", entityId: customRows[0]!.id, action: "delete", changes: { templateType: formType }, performedBy: req.user?.id });
  res.status(204).send();
});
