import type { Request } from "express";
import { getUserAccessLevel } from "../../middleware/departmentAccess.js";
import { AppError } from "../../utils/appError.js";
import type { PdfExport } from "../../drizzle/schema/pdfExports.js";
import { assertAttachmentAudience } from "../attachments/attachmentAccess.js";
import { resourceForFormType } from "../forms/formResource.js";

const DIRECT_RESOURCE: Record<string, Parameters<typeof getUserAccessLevel>[2]> = {
  fai: "fai",
  csa_fai: "fai",
  fuel_pump_fai: "fai",
  validation_report: "documents",
  document: "documents",
  document_control_index: "documents",
};

/**
 * The same audience that can open the source record. Quality reports follow
 * the reports route: a signed-in user, and the response never includes the
 * report body. A supplier login cannot open company records.
 */
export async function assertCanReadExport(req: Request, row: PdfExport): Promise<void> {
  if (req.user?.roleName === "supplier") throw AppError.forbidden("You can't open this record.");
  if (!req.user || !req.db) throw AppError.forbidden("You can't open this record.");
  if (row.entityType === "quality_report" || row.entityType == null) {
    if (row.entityType === "quality_report") return;
  }
  const entityType = row.entityType;
  const entityId = row.entityId;
  if (!entityType || entityId == null) throw AppError.forbidden("You can't open this record.");

  const parentTypes = new Set(["ncr", "capa", "eight_d", "csa_fai", "fuel_pump_fai", "fai", "validation_report"]);
  if (parentTypes.has(entityType)) {
    await assertAttachmentAudience(req, entityType, entityId);
    return;
  }

  const resource = DIRECT_RESOURCE[entityType] ?? resourceForFormType(entityType);
  if (!resource) throw AppError.forbidden("You can't open this record.");
  const level = await getUserAccessLevel(req.db, req.user, resource);
  if (level === "none") throw AppError.forbidden("You can't open this record.");
}
