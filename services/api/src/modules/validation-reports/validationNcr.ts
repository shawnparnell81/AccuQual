import type { Request, Response } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { validationReports } from "../../drizzle/schema/validationReport.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { openInspectionNcr, requireNcrEdit } from "../ncr/inspectionNcr.js";

export const validationNcrSchema = z.object({
  rows: z
    .array(
      z.object({
        measurement: z.string().trim().min(1).max(300),
        spec: z.string().trim().max(300),
        actual: z.string().trim().max(300),
        addr: z.string().trim().max(12).optional(),
      }),
    )
    .min(1)
    .max(40),
});

const TITLES: Record<string, string> = {
  csa: "CSA VALIDATION REPORT",
  fuel_pump: "FUEL PUMP VALIDATION DOCUMENT",
  air_strut: "AIR STRUT VALIDATION DOCUMENT",
  air_spring: "AIR SPRING VALIDATION DOCUMENT",
  fuel_injector: "FUEL INJECTOR VALIDATION DOCUMENT",
  brake_wear: "BRAKE WEAR SENSOR VALIDATION DOCUMENT",
  shock: "SHOCK VALIDATION REPORT",
  air_compressor: "AIR COMPRESSOR VALIDATION DOCUMENT",
  electric_lift: "ELECTRIC LIFT SUPPORT VALIDATION DOCUMENT",
  gas_lift: "GAS LIFT SUPPORT VALIDATION DOCUMENT",
  coil_spring: "COIL SPRING VALIDATION DOCUMENT",
};

/** POST /validation-reports/:id/ncr — a failed validation opens an NCR. The number stays blank. */
export const createValidationNcr = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw AppError.badRequest("Record is required");
  await requireNcrEdit(req.db!, { id: req.user?.id ?? 0, roleName: req.user?.roleName ?? null, department: req.user?.department ?? null });

  const body = validationNcrSchema.parse(req.body);
  const [report] = await req.db!.select().from(validationReports).where(eq(validationReports.id, id));
  if (!report) throw AppError.notFound("Validation Report");
  const data = (report.data ?? {}) as { formType?: string; cells?: Record<string, unknown>; linkedNcrs?: { id: number }[] };
  const formType = typeof data.formType === "string" ? data.formType : "csa";
  const formTitle = TITLES[formType] ?? "Validation report";
  const part = typeof data.cells?.B6 === "string" ? data.cells.B6.trim() : "";
  const title = part ? `${formTitle} failed — ${part}` : `${formTitle} failed`;
  const source = {
    reportId: id,
    formType,
    formTitle,
    path: `/validation-reports/${id}`,
    part,
    rows: body.rows,
  };
  const siteRows = await req.db!.execute<{ site_id: number | null }>(sql`SELECT site_id FROM validation_reports WHERE id = ${id} LIMIT 1`);
  const siteId = siteRows.rows[0]?.site_id ?? null;
  const created = await openInspectionNcr(
    req.db!,
    {
      formTitle,
      part,
      path: source.path,
      formType,
      sourceId: id,
      kind: "validation",
      siteId,
      fallbackSiteId: req.siteId,
      rows: body.rows,
      sourceAudit: { entityType: "Validation Report", entityId: id },
    },
    req.user?.id,
  );
  const linked = [...(Array.isArray(data.linkedNcrs) ? data.linkedNcrs : []), { id: created.id }];
  await req.db!.update(validationReports).set({ data: { ...(report.data ?? {}), linkedNcrs: linked } }).where(eq(validationReports.id, id));
  res.status(201).json({ id: created.id, recordNumber: created.recordNumber, title: created.title || title });
});
