import type { Request, Response } from "express";
import { and, desc, eq, gte, ilike, lte, sql, type SQL } from "drizzle-orm";
import { laborClaims } from "../../drizzle/schema/laborClaims.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { warrantyClaims } from "../../drizzle/schema/warranty.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { beginFormEditHandler, withScalarEdits } from "../forms/formEditAudit.js";
import { LABOR_NUMBER } from "../records/recordNumberSpecs.js";
import { applyRecordNumber, changesWithNumberEdit } from "../records/userRecordNumber.js";
import { stampRecordSite } from "../sites/recordSite.js";
import { optionalRows } from "../sites/optionalSql.js";
import { clearReportingCache } from "../reporting/reporting.service.js";

const NOT_READY = "Labor Claims isn't available until the database update runs.";

function pgCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  if ("code" in err && typeof (err as { code?: unknown }).code === "string") return (err as { code: string }).code;
  if ("cause" in err) return pgCode((err as { cause?: unknown }).cause);
  return null;
}

function missingRelation(err: unknown): boolean {
  const code = pgCode(err);
  return code === "42P01" || code === "42703";
}

function money(value: unknown): string | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return (Math.round(n * 100) / 100).toFixed(2);
}

function totalCost(hours: unknown, rate: unknown, total: unknown): string | null {
  const typed = money(total);
  if (typed != null && total !== undefined && total !== "") return typed;
  if (hours == null || hours === "" || rate == null || rate === "") return typed;
  const h = Number(hours);
  const r = Number(rate);
  if (!Number.isFinite(h) || !Number.isFinite(r)) return typed;
  return (Math.round(h * r * 100) / 100).toFixed(2);
}

function claimDay(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function assertLink(req: Request, kind: "warranty" | "ncr", id: number | null | undefined) {
  if (id == null) return;
  if (kind === "warranty") {
    const [row] = await req.db!.select({ id: warrantyClaims.id }).from(warrantyClaims).where(eq(warrantyClaims.id, id));
    if (!row) throw AppError.badRequest(`Warranty claim #${id} not found`);
    return;
  }
  const [row] = await req.db!.select({ id: ncr.id }).from(ncr).where(and(eq(ncr.id, id), eq(ncr.isDeleted, false)));
  if (!row) throw AppError.badRequest(`NCR #${id} not found`);
}

export const listLaborClaimsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { status, dateFrom, dateTo, q } = req.query as Record<string, string | undefined>;
  const conditions: SQL[] = [];
  if (status) conditions.push(eq(laborClaims.status, status));
  if (q) conditions.push(ilike(laborClaims.claimNumber, `%${q}%`));
  if (dateFrom) conditions.push(gte(laborClaims.claimDate, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(laborClaims.claimDate, new Date(`${dateTo}T23:59:59.999Z`)));
  try {
    const rows = await req.db!.select().from(laborClaims).where(and(...conditions)).orderBy(desc(laborClaims.claimDate), desc(laborClaims.id));
    res.json(rows);
  } catch (err) {
    if (missingRelation(err)) {
      res.json([]);
      return;
    }
    throw err;
  }
});

export const createLaborClaimHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as {
    claimNumber?: string;
    claimDate?: string | null;
    customerName?: string | null;
    partName?: string | null;
    laborHours?: number | string | null;
    laborRate?: number | string | null;
    totalLaborCost?: number | string | null;
    warrantyClaimId?: number | null;
    ncrId?: number | null;
    status?: string;
    notes?: string | null;
  };
  await assertLink(req, "warranty", body.warrantyClaimId);
  await assertLink(req, "ncr", body.ncrId);
  const values: Record<string, unknown> = { ...body };
  try {
    await applyRecordNumber(req.db!, values, LABOR_NUMBER);
    const [created] = await req
      .db!.insert(laborClaims)
      .values({
        claimNumber: (values.claimNumber as string | null) ?? null,
        claimDate: claimDay(body.claimDate),
        customerName: textOrNull(body.customerName),
        partName: textOrNull(body.partName),
        laborHours: money(body.laborHours),
        laborRate: money(body.laborRate),
        totalLaborCost: totalCost(body.laborHours, body.laborRate, body.totalLaborCost),
        warrantyClaimId: body.warrantyClaimId ?? null,
        ncrId: body.ncrId ?? null,
        status: body.status ?? "open",
        notes: textOrNull(body.notes),
        siteId: req.siteId ?? null,
        createdByUserId: req.user?.id,
      })
      .returning();
    await stampRecordSite(req.db!, "labor_claims", created!.id, req.siteId);
    await recordAuditTrail(req.db!, { entityType: "LaborClaim", entityId: created!.id, action: "create", changes: req.body, performedBy: req.user?.id });
    clearReportingCache();
    res.status(201).json(created);
  } catch (err) {
    if (missingRelation(err)) throw new AppError(NOT_READY, 503);
    throw err;
  }
});

async function loadClaim(req: Request, id: number) {
  try {
    const [row] = await req.db!.select().from(laborClaims).where(eq(laborClaims.id, id));
    if (!row) throw AppError.notFound("LaborClaim");
    return row;
  } catch (err) {
    if (missingRelation(err)) throw new AppError(NOT_READY, 503);
    throw err;
  }
}

export const getLaborClaimHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadClaim(req, Number(req.params.id));
  const warranty = record.warrantyClaimId
    ? await optionalRows<{ id: number; claim_number: string | null; status: string }>(
        req.db!,
        sql`SELECT id, claim_number, status FROM warranty_claims WHERE id = ${record.warrantyClaimId} LIMIT 1`,
      )
    : [];
  const linkedNcr = record.ncrId
    ? await optionalRows<{ id: number; title: string; status: string }>(req.db!, sql`SELECT id, title, status FROM ncr WHERE id = ${record.ncrId} LIMIT 1`)
    : [];
  const warrantyRow = warranty?.[0];
  const ncrRow = linkedNcr?.[0];
  res.json({
    ...record,
    warrantyClaim: warrantyRow ? { id: warrantyRow.id, claimNumber: warrantyRow.claim_number, status: warrantyRow.status } : null,
    linkedNcr: ncrRow ? { id: ncrRow.id, title: ncrRow.title, status: ncrRow.status } : null,
  });
});

export const updateLaborClaimHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadClaim(req, Number(req.params.id));
  const body = { ...(req.body as Record<string, unknown>) };
  if ("warrantyClaimId" in body) await assertLink(req, "warranty", body.warrantyClaimId == null ? null : Number(body.warrantyClaimId));
  if ("ncrId" in body) await assertLink(req, "ncr", body.ncrId == null ? null : Number(body.ncrId));
  const numberChange = await applyRecordNumber(req.db!, body, LABOR_NUMBER, { id: record.id, current: record.claimNumber, row: record });
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if ("claimNumber" in body) patch.claimNumber = body.claimNumber;
  if ("claimDate" in body) patch.claimDate = claimDay(body.claimDate);
  if ("customerName" in body) patch.customerName = textOrNull(body.customerName);
  if ("partName" in body) patch.partName = textOrNull(body.partName);
  if ("laborHours" in body) patch.laborHours = money(body.laborHours);
  if ("laborRate" in body) patch.laborRate = money(body.laborRate);
  if ("laborHours" in body || "laborRate" in body || "totalLaborCost" in body) {
    const hours = "laborHours" in body ? body.laborHours : record.laborHours;
    const rate = "laborRate" in body ? body.laborRate : record.laborRate;
    const total = "totalLaborCost" in body ? body.totalLaborCost : record.totalLaborCost;
    patch.totalLaborCost = totalCost(hours, rate, "totalLaborCost" in body ? body.totalLaborCost : total);
  }
  if ("warrantyClaimId" in body) patch.warrantyClaimId = body.warrantyClaimId == null ? null : Number(body.warrantyClaimId);
  if ("ncrId" in body) patch.ncrId = body.ncrId == null ? null : Number(body.ncrId);
  if ("status" in body) patch.status = body.status;
  if ("notes" in body) patch.notes = textOrNull(body.notes);
  const [updated] = await req.db!.update(laborClaims).set(patch).where(eq(laborClaims.id, record.id)).returning();
  const changes = withScalarEdits(record as unknown as Record<string, unknown>, patch, changesWithNumberEdit(body, numberChange));
  await recordAuditTrail(req.db!, { entityType: "LaborClaim", entityId: record.id, action: "update", changes, performedBy: req.user?.id });
  clearReportingCache();
  res.json(updated);
});

export const deleteLaborClaimHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadClaim(req, Number(req.params.id));
  await req.db!.delete(laborClaims).where(eq(laborClaims.id, record.id));
  await recordAuditTrail(req.db!, {
    entityType: "LaborClaim",
    entityId: record.id,
    action: "delete",
    changes: { claimNumber: record.claimNumber, snapshot: { siteId: record.siteId } },
    performedBy: req.user?.id,
  });
  clearReportingCache();
  res.status(204).send();
});

export const beginLaborClaimEdit = beginFormEditHandler("LaborClaim", async (db, id) => {
  const rows = await optionalRows<{ id: number }>(db, sql`SELECT id FROM labor_claims WHERE id = ${id} LIMIT 1`);
  if (rows == null) throw new AppError(NOT_READY, 503);
  return rows[0];
});
