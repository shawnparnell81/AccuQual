import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { users } from "../../drizzle/schema/users.js";
import { formatUserLabel } from "../users/userDisplay.js";
import { emptyFrame } from "../forms/controlledPdf.js";
import { applyChrome, loadPdfChrome, persistPdfExport } from "../pdf-exports/pdfExportStore.js";
import { sniffSpreadsheet } from "../../utils/fileSniff.js";
import { SUPPLIER_COLUMNS, SUPPLIER_UPLOAD_NOTE } from "./supplierHelp.js";
import { renderEngineeringReportPdf } from "./pdf.js";
import { buildEngineeringReport, deleteEngineeringReport, deleteReportImage, emailEngineeringReport, saveEngineeringNarrative, unlockEngineeringReport, verifyEngineeringReport, supplierTemplateFile, updateReportImageCaption, uploadEngineeringSupplier } from "./service.js";
import { loadReportImageFiles } from "./reportImages.js";
import { commitSourceFile, listSourceCoverage, previewSourceFile } from "./sourceStore.js";
import { qualityEngineeringReports } from "../../drizzle/schema/qualityEngineeringReport.js";
import { and } from "drizzle-orm";
import { engineeringAccess } from "./livePull.js";
import { listRecipientPeople } from "../reporting/recipientPeople.js";
import { DOCUMENT_ID, DOCUMENT_REVISION, DOCUMENT_TITLE, type EngineeringNarrative } from "./model.js";

function periodFrom(source: { year?: unknown; month?: unknown }): { year: number; month: number } {
  const year = Number(source.year);
  const month = Number(source.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw AppError.badRequest("Choose a year.");
  if (!Number.isInteger(month) || month < 1 || month > 12) throw AppError.badRequest("Choose a month.");
  return { year, month };
}

function actor(req: Request) {
  return {
    year: 0,
    month: 0,
    user: { id: req.user!.id, roleName: req.user!.roleName, department: req.user!.department },
    siteIds: req.allowedSiteIds ?? [],
    plantId: req.allSites ? null : (req.siteId ?? null),
  };
}

export const engineeringHelpHandler = asyncHandler(async (_req: Request, res: Response) => {
  res.json({
    documentId: DOCUMENT_ID,
    revision: DOCUMENT_REVISION,
    title: DOCUMENT_TITLE,
    note: SUPPLIER_UPLOAD_NOTE,
    datasets: SUPPLIER_COLUMNS,
    template: "GET /reports/engineering/template.csv",
  });
});

export const engineeringTemplateHandler = asyncHandler(async (_req: Request, res: Response) => {
  const file = supplierTemplateFile();
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
  res.send(file.body);
});

export const engineeringGetHandler = asyncHandler(async (req: Request, res: Response) => {
  const period = periodFrom(req.query);
  res.json(await buildEngineeringReport(req.db!, { ...actor(req), ...period }));
});

export const engineeringSaveHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as {
    year: number;
    month: number;
    narrative: Parameters<typeof saveEngineeringNarrative>[1]["narrative"];
    recipients?: string[];
  };
  res.json(
    await saveEngineeringNarrative(req.db!, {
      ...actor(req),
      year: body.year,
      month: body.month,
      narrative: body.narrative,
      recipients: body.recipients,
    }),
  );
});

export const engineeringPeopleHandler = asyncHandler(async (req: Request, res: Response) => {
  const access = await engineeringAccess(req.db!, { id: req.user!.id, roleName: req.user!.roleName, department: req.user!.department });
  if (!access.canRead) throw AppError.forbidden("You don't have access to the modules in this report.");
  res.json(await listRecipientPeople(req.db!));
});

export const engineeringEmailHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { year: number; month: number; recipients: string[]; narrative?: EngineeringNarrative };
  res.json(
    await emailEngineeringReport(req.db!, {
      ...actor(req),
      year: body.year,
      month: body.month,
      recipients: body.recipients,
      narrative: body.narrative,
    }),
  );
});

export const engineeringUploadHandler = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) throw AppError.badRequest("Choose a supplier CSV, Excel or Word file.");
  const isWord = /\.docx$/i.test(file.originalname);
  // A Word file is checked by extractFile (extension and contents must match); spreadsheets keep the existing check.
  if (!isWord && !sniffSpreadsheet(file.buffer, file.originalname)) throw AppError.badRequest("That file is not a CSV, Excel or Word document.");
  const period = periodFrom(req.body as { year?: unknown; month?: unknown });
  const replaceNotes = String((req.body as { replaceNotes?: unknown }).replaceNotes ?? "") === "true";
  const result = await uploadEngineeringSupplier(req.db!, {
    ...actor(req),
    ...period,
    fileName: file.originalname || "supplier.csv",
    buffer: file.buffer,
    replaceNotes,
  });
  res.json(result);
});

/** PATCH /reports/engineering/images/:attachmentId { year, month, caption } — edits one picture's caption. */
export const engineeringImageCaptionHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { year: number; month: number; caption: string };
  res.json(await updateReportImageCaption(req.db!, { ...actor(req), year: body.year, month: body.month, attachmentId: Number(req.params.attachmentId), caption: body.caption }));
});

/** DELETE /reports/engineering/images/:attachmentId?year=&month= — removes one picture from the report. */
export const engineeringImageDeleteHandler = asyncHandler(async (req: Request, res: Response) => {
  const period = periodFrom(req.query);
  res.json(await deleteReportImage(req.db!, { ...actor(req), ...period, attachmentId: Number(req.params.attachmentId) }));
});

/** DELETE /reports/engineering?year=&month= { pin } — deletes that month's report. Needs the delete permission and the person's PIN. */
export const engineeringDeleteHandler = asyncHandler(async (req: Request, res: Response) => {
  const period = periodFrom(req.query);
  const { pin } = req.body as { pin: string };
  res.json(await deleteEngineeringReport(req.db!, { ...actor(req), ...period, pin }));
});

export const engineeringPdfHandler = asyncHandler(async (req: Request, res: Response) => {
  const period = periodFrom(req.query);
  const report = await buildEngineeringReport(req.db!, { ...actor(req), ...period });
  const [person] = await req.db!.select({ name: users.name, email: users.email, isActive: users.isActive }).from(users).where(eq(users.id, req.user!.id));
  const chrome = await loadPdfChrome(req.db!, "quality_engineering_report", null, {});
  const frame = applyChrome(
    emptyFrame({
      sourceModule: DOCUMENT_TITLE,
      recordNumber: `QE-${period.year}-${String(period.month).padStart(2, "0")}`,
      revision: DOCUMENT_REVISION,
      generatedBy: formatUserLabel(person, req.user!.id),
      generatedAt: new Date(),
      formNumber: DOCUMENT_ID,
      status: report.executive.departmentStatus || null,
    }),
    chrome,
  );
  const [saved] = await req.db!
    .select({ id: qualityEngineeringReports.id })
    .from(qualityEngineeringReports)
    .where(and(eq(qualityEngineeringReports.year, period.year), eq(qualityEngineeringReports.month, period.month), eq(qualityEngineeringReports.isDeleted, false)));
  const images = saved ? await loadReportImageFiles(req.db!, saved.id, report.narrative.images) : [];
  const bytes = await renderEngineeringReportPdf(report, frame, images);
  await persistPdfExport(req.db!, bytes, frame, { entityType: "quality_engineering_report", entityId: null, actorId: req.user!.id });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("X-Export-Id", chrome.exportId);
  res.setHeader("Content-Disposition", `attachment; filename="quality-engineering-${period.year}-${String(period.month).padStart(2, "0")}.pdf"`);
  res.send(Buffer.from(bytes));
});

async function requireSourceEdit(req: Request) {
  const access = await engineeringAccess(req.db!, { id: req.user!.id, roleName: req.user!.roleName, department: req.user!.department });
  if (!access.canEdit) throw AppError.forbidden("You can't import monthly source files.");
}

function sourceFile(req: Request) {
  const file = req.file;
  if (!file) throw AppError.badRequest("Choose a monthly source spreadsheet (.xlsx).");
  if (!/\.xlsx$/i.test(file.originalname) || !sniffSpreadsheet(file.buffer, file.originalname)) throw AppError.badRequest("That file is not an Excel workbook (.xlsx).");
  return { fileName: file.originalname, buffer: file.buffer };
}

/** POST /reports/engineering/sources/preview (multipart file) — what an import would add, update and remove. Writes nothing. */
export const engineeringSourcePreviewHandler = asyncHandler(async (req: Request, res: Response) => {
  await requireSourceEdit(req);
  res.json(await previewSourceFile(req.db!, sourceFile(req)));
});

/** POST /reports/engineering/sources (multipart file) — stores the rows by their own months and logs the import. */
export const engineeringSourceCommitHandler = asyncHandler(async (req: Request, res: Response) => {
  await requireSourceEdit(req);
  res.json(await commitSourceFile(req.db!, { ...sourceFile(req), userId: req.user!.id }));
});

/** GET /reports/engineering/sources — recent imports and the rows stored per source and month. */
export const engineeringSourceListHandler = asyncHandler(async (req: Request, res: Response) => {
  const access = await engineeringAccess(req.db!, { id: req.user!.id, roleName: req.user!.roleName, department: req.user!.department });
  if (!access.canRead) throw AppError.forbidden("You don't have access to this report.");
  res.json(await listSourceCoverage(req.db!));
});

/** POST /reports/engineering/verify?year&month — finalizes the month and deletes its raw source rows. */
export const engineeringVerifyHandler = asyncHandler(async (req: Request, res: Response) => {
  const period = periodFrom(req.query);
  res.json(await verifyEngineeringReport(req.db!, { ...actor(req), ...period }));
});

/** POST /reports/engineering/unlock?year&month — reopens a verified month for editing (plain confirm in the app, audit-logged). */
export const engineeringUnlockHandler = asyncHandler(async (req: Request, res: Response) => {
  const period = periodFrom(req.query);
  res.json(await unlockEngineeringReport(req.db!, { ...actor(req), ...period }));
});
