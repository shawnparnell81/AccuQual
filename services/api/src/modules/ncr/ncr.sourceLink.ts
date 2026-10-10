import type { Request, Response } from "express";
import { and, eq, ilike, or } from "drizzle-orm";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { validationReports } from "../../drizzle/schema/validationReport.js";
import { isoQualityForms } from "../../drizzle/schema/isoQualityForms.js";
import { qmsForms } from "../../drizzle/schema/qmsForms.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { showRecordNumber } from "../records/userRecordNumber.js";
import type { Db } from "../../lib/requestDb.js";

export type NcrSourceKind = "validation" | "iso" | "qms";

export interface NcrSourceHit {
  kind: NcrSourceKind;
  id: number;
  recordNumber: string;
  title: string;
  path: string;
}

function like(query: string): string {
  const cleaned = query.trim().replace(/[\\%_]/g, "");
  return `%${cleaned}%`;
}

/** Validation reports, ISO forms, and QMS forms whose number matches what was typed. */
export async function searchNcrSources(db: Db, query: string): Promise<NcrSourceHit[]> {
  const term = query.trim();
  if (term.length < 2) return [];
  const pattern = like(term);
  const [validations, iso, qms] = await Promise.all([
    db
      .select({ id: validationReports.id, recordNumber: validationReports.recordNumber, data: validationReports.data })
      .from(validationReports)
      .where(ilike(validationReports.recordNumber, pattern))
      .limit(8),
    db
      .select({ id: isoQualityForms.id, recordNumber: isoQualityForms.recordNumber, formType: isoQualityForms.formType })
      .from(isoQualityForms)
      .where(ilike(isoQualityForms.recordNumber, pattern))
      .limit(8),
    db
      .select({ id: qmsForms.id, formNo: qmsForms.formNo, formType: qmsForms.formType })
      .from(qmsForms)
      .where(or(ilike(qmsForms.formNo, pattern), ilike(qmsForms.formType, pattern)))
      .limit(8),
  ]);
  const hits: NcrSourceHit[] = [];
  for (const row of validations) {
    const number = showRecordNumber(row.recordNumber);
    hits.push({ kind: "validation", id: row.id, recordNumber: number, title: number || "Validation report", path: `/validation-reports/${row.id}` });
  }
  for (const row of iso) {
    const number = showRecordNumber(row.recordNumber);
    hits.push({ kind: "iso", id: row.id, recordNumber: number, title: number || row.formType, path: `/iso-forms/record/${row.id}` });
  }
  for (const row of qms) {
    const number = (row.formNo ?? "").trim();
    hits.push({ kind: "qms", id: row.id, recordNumber: number, title: number || row.formType, path: `/qms-forms/${row.formType}/${row.id}` });
  }
  const wanted = term.toLowerCase();
  return hits.filter((hit) => hit.recordNumber.toLowerCase().includes(wanted) || hit.title.toLowerCase().includes(wanted)).slice(0, 12);
}

function sourceTitle(kind: NcrSourceKind, recordNumber: string): string {
  if (kind === "validation") return recordNumber ? `Validation ${recordNumber}` : "Validation report";
  if (kind === "iso") return recordNumber ? `ISO form ${recordNumber}` : "ISO form";
  return recordNumber ? `QMS form ${recordNumber}` : "QMS form";
}

/** Stores the source on the NCR and, for a validation report, the NCR id on that report. */
export async function linkNcrSource(db: Db, ncrId: number, kind: NcrSourceKind, sourceId: number, performedBy?: number) {
  const [row] = await db.select().from(ncr).where(and(eq(ncr.id, ncrId), eq(ncr.isDeleted, false)));
  if (!row) throw AppError.notFound("NCR");
  if (row.processData?.locked === true) throw AppError.badRequest("This NCR is closed and locked.");

  let recordNumber = "";
  let path = "";
  let formTitle = "";
  if (kind === "validation") {
    const [report] = await db.select().from(validationReports).where(eq(validationReports.id, sourceId));
    if (!report) throw AppError.notFound("Validation Report");
    recordNumber = showRecordNumber(report.recordNumber);
    path = `/validation-reports/${report.id}`;
    formTitle = sourceTitle(kind, recordNumber);
    const data = (report.data ?? {}) as { linkedNcrs?: { id: number }[] };
    const linked = [...(Array.isArray(data.linkedNcrs) ? data.linkedNcrs : []).filter((item) => item.id !== ncrId), { id: ncrId }];
    await db.update(validationReports).set({ data: { ...(report.data ?? {}), linkedNcrs: linked }, updatedAt: new Date() }).where(eq(validationReports.id, report.id));
    await recordAuditTrail(db, {
      entityType: "Validation Report",
      entityId: report.id,
      action: "update",
      changes: { event: "ncr_linked", ncrId, summary: `Linked NCR ${ncrId}.` },
      performedBy,
    });
  } else if (kind === "iso") {
    const [form] = await db.select().from(isoQualityForms).where(eq(isoQualityForms.id, sourceId));
    if (!form) throw AppError.notFound("ISO form");
    recordNumber = showRecordNumber(form.recordNumber);
    path = `/iso-forms/record/${form.id}`;
    formTitle = sourceTitle(kind, recordNumber);
    const data = (form.data ?? {}) as { linkedNcrs?: { id: number }[] };
    const linked = [...(Array.isArray(data.linkedNcrs) ? data.linkedNcrs : []).filter((item) => item.id !== ncrId), { id: ncrId }];
    await db.update(isoQualityForms).set({ data: { ...form.data, linkedNcrs: linked } as typeof form.data, updatedAt: new Date() }).where(eq(isoQualityForms.id, form.id));
    await recordAuditTrail(db, {
      entityType: "ISO Quality Form",
      entityId: form.id,
      action: "update",
      changes: { event: "ncr_linked", ncrId, summary: `Linked NCR ${ncrId}.` },
      performedBy,
    });
  } else {
    const [form] = await db.select().from(qmsForms).where(eq(qmsForms.id, sourceId));
    if (!form) throw AppError.notFound("QMS form");
    recordNumber = (form.formNo ?? "").trim();
    path = `/qms-forms/${form.formType}/${form.id}`;
    formTitle = sourceTitle(kind, recordNumber);
  }

  const validationSource = { kind, reportId: sourceId, formTitle, path, recordNumber };
  const processData = { ...(row.processData ?? {}), validationSource };
  const [updated] = await db.update(ncr).set({ processData, updatedAt: new Date() }).where(eq(ncr.id, ncrId)).returning();
  await recordAuditTrail(db, {
    entityType: "NCR",
    entityId: ncrId,
    action: "update",
    changes: { event: "source_linked", kind, sourceId, path, recordNumber, summary: `Linked to ${formTitle}.` },
    performedBy,
  });
  return updated ?? { ...row, processData };
}

export const searchNcrSourcesHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = typeof req.query.q === "string" ? req.query.q : "";
  res.json(await searchNcrSources(req.db!, query));
});

export const linkNcrSourceHandler = asyncHandler(async (req: Request, res: Response) => {
  const updated = await linkNcrSource(req.db!, Number(req.params.id), req.body.kind, req.body.id, req.user?.id);
  res.json(updated);
});

/** Matches a typed number such as DEMO-CSA-002 against the stored record number. */
export function sourceNumberMatches(recordNumber: string | null | undefined, query: string): boolean {
  const left = (recordNumber ?? "").trim().toLowerCase();
  const right = query.trim().toLowerCase();
  if (!left || !right) return false;
  return left.includes(right);
}
