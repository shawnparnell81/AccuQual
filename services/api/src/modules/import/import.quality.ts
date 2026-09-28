import { eq, inArray, sql } from "drizzle-orm";
import { customers } from "../../drizzle/schema/customers.js";
import { supplierScorecards, suppliers } from "../../drizzle/schema/supplier.js";
import { supplierDocuments } from "../../drizzle/schema/supplierPortal.js";
import { qualityInspectionItems, qualityInspectionReports } from "../../drizzle/schema/qualityInspectionReports.js";
import { inventoryItems } from "../../drizzle/schema/inventory.js";
import { inventoryLots } from "../../drizzle/schema/inventoryLots.js";
import { equipment } from "../../drizzle/schema/calibration.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import type { AnyImportEntity, ImportContext, ImportField } from "./import.entities.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SEP = "\u001f";

function joinKey(parts: string[]): string {
  return parts.map((part) => part.trim().toLowerCase()).join(SEP);
}

function parseNumber(text: string, label: string, errors: string[], opts: { min?: number; max?: number; integer?: boolean } = {}): number | undefined {
  if (text.trim() === "") return undefined;
  const value = Number(text.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(value)) {
    errors.push(`${label} "${text}" isn't a number.`);
    return undefined;
  }
  if (opts.integer && !Number.isInteger(value)) errors.push(`${label} must be a whole number.`);
  if (opts.min !== undefined && value < opts.min) errors.push(`${label} can't be below ${opts.min}.`);
  if (opts.max !== undefined && value > opts.max) errors.push(`${label} can't be above ${opts.max}.`);
  return value;
}

function parseDate(text: string, label: string, errors: string[]): Date | undefined {
  const raw = text.trim();
  if (!raw) return undefined;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) {
    const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    if (!Number.isNaN(date.getTime())) return date;
  }
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (us) {
    const date = new Date(Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2])));
    if (!Number.isNaN(date.getTime())) return date;
  }
  errors.push(`${label} "${raw}" isn't a date. Use YYYY-MM-DD.`);
  return undefined;
}

function dateKey(value: Date | undefined): string {
  return value ? value.toISOString().slice(0, 10) : "";
}

async function supplierMap(ctx: ImportContext) {
  const rows = await ctx.db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers);
  return new Map(rows.map((row) => [row.name.trim().toLowerCase(), row.id]));
}

// ---------- Customer quality contacts ----------

interface CustomerValue {
  legalName: string;
  primaryContactName?: string;
  primaryContactEmail?: string;
  primaryContactPhone?: string;
}

const customerFields: ImportField[] = [
  { key: "legalName", label: "Customer name", required: true, example: "Northwind Medical", aliases: ["customer", "company", "legal name", "name"] },
  { key: "primaryContactName", label: "Contact name", example: "Priya Shah", aliases: ["contact", "contact name", "primary contact", "quality contact name"] },
  { key: "primaryContactEmail", label: "Contact email", example: "quality@northwind.example", aliases: ["email", "contact email", "e-mail", "quality contact email"] },
  { key: "primaryContactPhone", label: "Phone", example: "555-0100", aliases: ["phone", "telephone", "quality contact phone"] },
];

const customerEntity: AnyImportEntity = {
  key: "customers",
  label: "Customer contacts",
  description: "Quality contacts for customers you already work with. This does not create sales accounts.",
  fields: customerFields,
  identityOf: (raw) => (raw.legalName ?? "").trim().toLowerCase(),
  async prepare(ctx) {
    const rows = await ctx.db.select({ id: customers.id, legalName: customers.legalName }).from(customers);
    return {
      existing: new Set(rows.map((row) => row.legalName.trim().toLowerCase())),
      ids: new Map(rows.map((row) => [row.legalName.trim().toLowerCase(), row.id])),
    };
  },
  validate(raw) {
    const errors: string[] = [];
    const legalName = raw.legalName?.trim() ?? "";
    if (!legalName) errors.push("Customer name is required.");
    if (legalName.length > 200) errors.push("Customer name is longer than 200 characters.");
    const email = raw.primaryContactEmail?.trim();
    if (email && !EMAIL.test(email)) errors.push(`Contact email "${email}" doesn't look like an email address.`);
    const value: CustomerValue = {
      legalName,
      primaryContactName: raw.primaryContactName?.trim() || undefined,
      primaryContactEmail: email || undefined,
      primaryContactPhone: raw.primaryContactPhone?.trim() || undefined,
    };
    return { errors, value: errors.length ? undefined : value, identity: legalName.toLowerCase() };
  },
  async insert(ctx, value) {
    const row = value as CustomerValue;
    const [created] = await ctx.db
      .insert(customers)
      .values({ legalName: row.legalName, primaryContactName: row.primaryContactName, primaryContactEmail: row.primaryContactEmail, primaryContactPhone: row.primaryContactPhone, status: "approved", createdBy: ctx.userId })
      .returning();
    await recordAuditTrail(ctx.db, { entityType: "Customer", entityId: created!.id, action: "create", changes: { legalName: row.legalName, source: "data_import" }, performedBy: ctx.userId });
    return { id: created!.id, label: row.legalName };
  },
  async update(ctx, id, value) {
    const row = value as CustomerValue;
    await ctx.db
      .update(customers)
      .set({ primaryContactName: row.primaryContactName, primaryContactEmail: row.primaryContactEmail, primaryContactPhone: row.primaryContactPhone, updatedAt: new Date() })
      .where(eq(customers.id, id));
    await recordAuditTrail(ctx.db, { entityType: "Customer", entityId: id, action: "update", changes: { legalName: row.legalName, source: "data_import" }, performedBy: ctx.userId });
    return { id, label: row.legalName };
  },
};

// ---------- Supplier scorecards ----------

interface ScorecardValue {
  supplierName: string;
  supplierId: number;
  period: string;
  qualityScore?: number;
  deliveryScore?: number;
  overallScore?: number;
  notes?: string;
}

const scorecardEntity: AnyImportEntity = {
  key: "supplier_scorecards",
  label: "Supplier scorecards",
  description: "Quality and delivery scores for a supplier and a period, such as 2026-Q1. The supplier must already exist.",
  fields: [
    { key: "supplier", label: "Supplier name", required: true, example: "Acme Fasteners", aliases: ["supplier", "vendor", "vendor name"] },
    { key: "period", label: "Period", required: true, example: "2026-Q1", aliases: ["quarter", "month", "score period"] },
    { key: "qualityScore", label: "Quality score", example: "92", aliases: ["quality", "quality rating"] },
    { key: "deliveryScore", label: "Delivery score", example: "88", aliases: ["delivery", "delivery rating"] },
    { key: "overallScore", label: "Overall score", example: "90", aliases: ["overall", "score", "total"] },
    { key: "notes", label: "Notes", aliases: ["comments", "note"] },
  ],
  identityOf: (raw) => joinKey([raw.supplier ?? "", raw.period ?? ""]),
  async prepare(ctx, identities) {
    const byName = await supplierMap(ctx);
    const wanted = new Set(identities.map((key) => key.split(SEP)[0] ?? "").filter(Boolean));
    const supplierIds = [...byName.entries()].filter(([name]) => wanted.has(name)).map(([, id]) => id);
    const existing = new Set<string>();
    const ids = new Map<string, number>();
    if (supplierIds.length > 0) {
      const nameById = new Map([...byName.entries()].map(([name, id]) => [id, name]));
      const cards = await ctx.db.select().from(supplierScorecards).where(inArray(supplierScorecards.supplierId, supplierIds));
      for (const card of cards) {
        const key = joinKey([nameById.get(card.supplierId) ?? "", card.period ?? ""]);
        existing.add(key);
        ids.set(key, card.id);
      }
    }
    return { existing, ids, byName };
  },
  validate(raw, lookups) {
    const errors: string[] = [];
    const supplierName = raw.supplier?.trim() ?? "";
    const period = raw.period?.trim() ?? "";
    if (!supplierName) errors.push("Supplier name is required.");
    if (!period) errors.push("Period is required.");
    const byName = lookups.byName as Map<string, number>;
    const supplierId = supplierName ? byName.get(supplierName.toLowerCase()) : undefined;
    if (supplierName && supplierId === undefined) errors.push(`Supplier "${supplierName}" doesn't exist yet. Import or add the supplier first.`);
    const qualityScore = parseNumber(raw.qualityScore ?? "", "Quality score", errors, { min: 0, max: 100 });
    const deliveryScore = parseNumber(raw.deliveryScore ?? "", "Delivery score", errors, { min: 0, max: 100 });
    const overallScore = parseNumber(raw.overallScore ?? "", "Overall score", errors, { min: 0, max: 100 });
    const value: ScorecardValue = { supplierName, supplierId: supplierId ?? 0, period, qualityScore, deliveryScore, overallScore, notes: raw.notes?.trim() || undefined };
    return { errors, value: errors.length ? undefined : value, identity: joinKey([supplierName, period]) };
  },
  async insert(ctx, value) {
    const row = value as ScorecardValue;
    const [created] = await ctx.db
      .insert(supplierScorecards)
      .values({ supplierId: row.supplierId, period: row.period, qualityScore: row.qualityScore?.toString(), deliveryScore: row.deliveryScore?.toString(), overallScore: row.overallScore?.toString(), notes: row.notes })
      .returning();
    await recordAuditTrail(ctx.db, { entityType: "SupplierScorecard", entityId: created!.id, action: "create", changes: { supplier: row.supplierName, period: row.period, source: "data_import" }, performedBy: ctx.userId });
    return { id: created!.id, label: `${row.supplierName} ${row.period}` };
  },
  async update(ctx, id, value) {
    const row = value as ScorecardValue;
    await ctx.db
      .update(supplierScorecards)
      .set({ qualityScore: row.qualityScore?.toString(), deliveryScore: row.deliveryScore?.toString(), overallScore: row.overallScore?.toString(), notes: row.notes })
      .where(eq(supplierScorecards.id, id));
    await recordAuditTrail(ctx.db, { entityType: "SupplierScorecard", entityId: id, action: "update", changes: { supplier: row.supplierName, period: row.period, source: "data_import" }, performedBy: ctx.userId });
    return { id, label: `${row.supplierName} ${row.period}` };
  },
};

// ---------- Supplier certifications (stored as supplier documents) ----------

interface CertValue {
  supplierName: string;
  supplierId: number;
  name: string;
  certificateNumber: string;
}

const certificationEntity: AnyImportEntity = {
  key: "supplier_certifications",
  label: "Supplier certifications",
  description: "Certificate records on file for a supplier, such as ISO 9001. The file itself is not uploaded here — only the record. The supplier must already exist.",
  fields: [
    { key: "supplier", label: "Supplier name", required: true, example: "Acme Fasteners", aliases: ["supplier", "vendor"] },
    { key: "name", label: "Certificate name", required: true, example: "ISO 9001", aliases: ["certificate", "certification", "document", "standard"] },
    { key: "certificateNumber", label: "Certificate number", example: "ISO-10042", aliases: ["number", "cert number", "certificate no", "id"] },
  ],
  identityOf: (raw) => joinKey([raw.supplier ?? "", raw.certificateNumber?.trim() || raw.name || ""]),
  async prepare(ctx, identities) {
    const byName = await supplierMap(ctx);
    const wanted = new Set(identities.map((key) => key.split(SEP)[0] ?? "").filter(Boolean));
    const supplierIds = [...byName.entries()].filter(([name]) => wanted.has(name)).map(([, id]) => id);
    const existing = new Set<string>();
    const ids = new Map<string, number>();
    if (supplierIds.length > 0) {
      const nameById = new Map([...byName.entries()].map(([name, id]) => [id, name]));
      const docs = await ctx.db.select().from(supplierDocuments).where(inArray(supplierDocuments.supplierId, supplierIds));
      for (const doc of docs) {
        if ((doc.category ?? "").toLowerCase() !== "certification") continue;
        const key = joinKey([nameById.get(doc.supplierId) ?? "", doc.fileName]);
        existing.add(key);
        ids.set(key, doc.id);
      }
    }
    return { existing, ids, byName };
  },
  validate(raw, lookups) {
    const errors: string[] = [];
    const supplierName = raw.supplier?.trim() ?? "";
    const name = raw.name?.trim() ?? "";
    const certificateNumber = raw.certificateNumber?.trim() || name;
    if (!supplierName) errors.push("Supplier name is required.");
    if (!name) errors.push("Certificate name is required.");
    const byName = lookups.byName as Map<string, number>;
    const supplierId = supplierName ? byName.get(supplierName.toLowerCase()) : undefined;
    if (supplierName && supplierId === undefined) errors.push(`Supplier "${supplierName}" doesn't exist yet. Import or add the supplier first.`);
    const value: CertValue = { supplierName, supplierId: supplierId ?? 0, name, certificateNumber };
    return { errors, value: errors.length ? undefined : value, identity: joinKey([supplierName, certificateNumber]) };
  },
  async insert(ctx, value) {
    const row = value as CertValue;
    const [created] = await ctx.db
      .insert(supplierDocuments)
      .values({ supplierId: row.supplierId, name: row.name, category: "certification", fileName: row.certificateNumber, filePath: "imported", uploadedByUserId: ctx.userId })
      .returning();
    await recordAuditTrail(ctx.db, { entityType: "SupplierDocument", entityId: created!.id, action: "create", changes: { supplier: row.supplierName, name: row.name, source: "data_import" }, performedBy: ctx.userId });
    return { id: created!.id, label: `${row.supplierName} ${row.name}` };
  },
  async update(ctx, id, value) {
    const row = value as CertValue;
    await ctx.db.update(supplierDocuments).set({ name: row.name, fileName: row.certificateNumber }).where(eq(supplierDocuments.id, id));
    await recordAuditTrail(ctx.db, { entityType: "SupplierDocument", entityId: id, action: "update", changes: { supplier: row.supplierName, name: row.name, source: "data_import" }, performedBy: ctx.userId });
    return { id, label: `${row.supplierName} ${row.name}` };
  },
};

// ---------- Inspection / measurement results ----------

interface InspectionValue {
  part: string;
  lot: string;
  date?: Date;
  dateText: string;
  parameter: string;
  specification?: string;
  actual?: string;
  result?: string;
  unit?: string;
  specMin?: number;
  specMax?: number;
  actualValue?: number;
  reportKey: string;
}

const inspectionEntity: AnyImportEntity = {
  key: "inspection_results",
  label: "Inspection results",
  description: "Measured results. Rows with the same part, lot, and date are kept on one inspection report.",
  fields: [
    { key: "partMaterialNo", label: "Part number", required: true, example: "FST-0042", aliases: ["part", "part no", "sku", "material"] },
    { key: "batchLotNo", label: "Lot / batch", example: "L-100", aliases: ["lot", "batch", "lot number", "batch number"] },
    { key: "inspectionDate", label: "Inspection date", example: "2026-03-01", aliases: ["date", "inspected"] },
    { key: "parameter", label: "Parameter", required: true, example: "Length", aliases: ["characteristic", "check", "measurement"] },
    { key: "specification", label: "Specification", example: "10.0 ± 0.1", aliases: ["spec", "requirement"] },
    { key: "actualFinding", label: "Actual finding", example: "10.02", aliases: ["actual", "result text", "finding"] },
    { key: "result", label: "Result", help: "Pass or fail. Blank is allowed.", example: "pass", aliases: ["pass fail", "disposition"] },
    { key: "measurementUnit", label: "Unit", example: "mm", aliases: ["uom", "units"] },
    { key: "specMin", label: "Spec minimum", example: "9.9", aliases: ["min", "lower spec"] },
    { key: "specMax", label: "Spec maximum", example: "10.1", aliases: ["max", "upper spec"] },
    { key: "actualValue", label: "Actual value", example: "10.02", aliases: ["measured", "reading"] },
  ],
  identityOf: (raw) => joinKey([raw.partMaterialNo ?? "", raw.batchLotNo ?? "", raw.inspectionDate ?? "", raw.parameter ?? ""]),
  async prepare(ctx, identities) {
    const parts = [...new Set(identities.map((key) => key.split(SEP)[0] ?? "").filter(Boolean))];
    const existing = new Set<string>();
    const ids = new Map<string, number>();
    const reportIds = new Map<string, number>();
    for (let i = 0; i < parts.length; i += 500) {
      const chunk = parts.slice(i, i + 500);
      if (chunk.length === 0) continue;
      const reports = await ctx.db
        .select({ id: qualityInspectionReports.id, part: qualityInspectionReports.partMaterialNo, lot: qualityInspectionReports.batchLotNo, date: qualityInspectionReports.inspectionDate })
        .from(qualityInspectionReports)
        .where(inArray(sql`lower(${qualityInspectionReports.partMaterialNo})`, chunk));
      const reportById = new Map<number, { part: string; lot: string; date: string }>();
      for (const report of reports) {
        const info = { part: report.part ?? "", lot: report.lot ?? "", date: dateKey(report.date ?? undefined) };
        reportById.set(report.id, info);
        reportIds.set(joinKey([info.part, info.lot, info.date]), report.id);
      }
      const reportIdList = [...reportById.keys()];
      if (reportIdList.length === 0) continue;
      const items = await ctx.db.select().from(qualityInspectionItems).where(inArray(qualityInspectionItems.reportId, reportIdList));
      for (const item of items) {
        const report = reportById.get(item.reportId);
        if (!report) continue;
        const key = joinKey([report.part, report.lot, report.date, item.parameter ?? ""]);
        existing.add(key);
        ids.set(key, item.id);
      }
    }
    return { existing, ids, reportIds };
  },
  validate(raw) {
    const errors: string[] = [];
    const part = raw.partMaterialNo?.trim() ?? "";
    const lot = raw.batchLotNo?.trim() ?? "";
    const parameter = raw.parameter?.trim() ?? "";
    if (!part) errors.push("Part number is required.");
    if (!parameter) errors.push("Parameter is required.");
    const date = parseDate(raw.inspectionDate ?? "", "Inspection date", errors);
    const resultText = raw.result?.trim().toLowerCase();
    let result: string | undefined;
    if (resultText) {
      if (["pass", "passed", "ok", "accept", "accepted"].includes(resultText)) result = "pass";
      else if (["fail", "failed", "reject", "rejected", "ng"].includes(resultText)) result = "fail";
      else errors.push(`Result "${raw.result}" should be pass or fail.`);
    }
    const specMin = parseNumber(raw.specMin ?? "", "Spec minimum", errors);
    const specMax = parseNumber(raw.specMax ?? "", "Spec maximum", errors);
    const actualValue = parseNumber(raw.actualValue ?? "", "Actual value", errors);
    const dateText = dateKey(date);
    const value: InspectionValue = {
      part,
      lot,
      date,
      dateText,
      parameter,
      specification: raw.specification?.trim() || undefined,
      actual: raw.actualFinding?.trim() || undefined,
      result,
      unit: raw.measurementUnit?.trim() || undefined,
      specMin,
      specMax,
      actualValue,
      reportKey: joinKey([part, lot, dateText]),
    };
    return { errors, value: errors.length ? undefined : value, identity: joinKey([part, lot, dateText, parameter]) };
  },
  async insert(ctx, value, lookups) {
    const row = value as InspectionValue;
    const reportIds = lookups.reportIds as Map<string, number>;
    let reportId = reportIds.get(row.reportKey);
    if (!reportId) {
      const [created] = await ctx.db
        .insert(qualityInspectionReports)
        .values({ partMaterialNo: row.part, batchLotNo: row.lot || null, inspectionDate: row.date, createdBy: ctx.userId })
        .returning();
      reportId = created!.id;
      reportIds.set(row.reportKey, reportId);
      await recordAuditTrail(ctx.db, { entityType: "QualityInspectionReport", entityId: reportId, action: "create", changes: { part: row.part, lot: row.lot, source: "data_import" }, performedBy: ctx.userId });
    }
    const [item] = await ctx.db
      .insert(qualityInspectionItems)
      .values({
        reportId,
        parameter: row.parameter,
        specification: row.specification,
        actualFinding: row.actual,
        result: row.result,
        specMin: row.specMin?.toString(),
        specMax: row.specMax?.toString(),
        actualValue: row.actualValue?.toString(),
        measurementUnit: row.unit,
      })
      .returning();
    return { id: item!.id, label: `${row.part} ${row.parameter}` };
  },
  async update(ctx, id, value) {
    const row = value as InspectionValue;
    await ctx.db
      .update(qualityInspectionItems)
      .set({
        specification: row.specification,
        actualFinding: row.actual,
        result: row.result,
        specMin: row.specMin?.toString(),
        specMax: row.specMax?.toString(),
        actualValue: row.actualValue?.toString(),
        measurementUnit: row.unit,
        updatedAt: new Date(),
      })
      .where(eq(qualityInspectionItems.id, id));
    return { id, label: `${row.part} ${row.parameter}` };
  },
};

// ---------- Lots ----------

interface LotValue {
  sku: string;
  itemId: number;
  lotNumber: string;
  quantity: number;
  serialNumber?: string;
  supplierId?: number;
  expirationDate?: Date;
  status: string;
}

const lotEntity: AnyImportEntity = {
  key: "lots",
  label: "Lots and batches",
  description: "Lot or batch quantities for a part that already exists. The part is matched by its part number.",
  fields: [
    { key: "sku", label: "Part number", required: true, example: "FST-0042", aliases: ["sku", "part", "part no", "item"] },
    { key: "lotNumber", label: "Lot / batch number", required: true, example: "L-100", aliases: ["lot", "batch", "lot number", "batch number"] },
    { key: "quantity", label: "Quantity", required: true, example: "500", aliases: ["qty", "received", "received qty", "on hand"] },
    { key: "serialNumber", label: "Serial number", aliases: ["serial", "sn"] },
    { key: "supplier", label: "Supplier name", help: "Must match a supplier that already exists.", example: "Acme Fasteners", aliases: ["vendor"] },
    { key: "expirationDate", label: "Expiration date", example: "2027-01-31", aliases: ["expires", "expiry", "exp date"] },
    { key: "status", label: "Status", help: "Active, consumed, scrapped, returned, or expired. Blank means active.", example: "active", aliases: ["state"] },
  ],
  identityOf: (raw) => joinKey([raw.sku ?? "", raw.lotNumber ?? ""]),
  async prepare(ctx, identities) {
    const skus = [...new Set(identities.map((key) => key.split(SEP)[0] ?? "").filter(Boolean))];
    const existing = new Set<string>();
    const ids = new Map<string, number>();
    const itemIds = new Map<string, number>();
    for (let i = 0; i < skus.length; i += 500) {
      const chunk = skus.slice(i, i + 500);
      if (chunk.length === 0) continue;
      const items = await ctx.db.select({ id: inventoryItems.id, sku: inventoryItems.sku }).from(inventoryItems).where(inArray(sql`lower(${inventoryItems.sku})`, chunk));
      const skuById = new Map<number, string>();
      for (const item of items) {
        const key = item.sku.trim().toLowerCase();
        itemIds.set(key, item.id);
        skuById.set(item.id, key);
      }
      const itemIdList = [...skuById.keys()];
      if (itemIdList.length === 0) continue;
      const lots = await ctx.db.select().from(inventoryLots).where(inArray(inventoryLots.itemId, itemIdList));
      for (const lot of lots) {
        const key = joinKey([skuById.get(lot.itemId) ?? "", lot.lotNumber]);
        existing.add(key);
        ids.set(key, lot.id);
      }
    }
    const byName = await supplierMap(ctx);
    return { existing, ids, itemIds, byName };
  },
  validate(raw, lookups) {
    const errors: string[] = [];
    const sku = raw.sku?.trim() ?? "";
    const lotNumber = raw.lotNumber?.trim() ?? "";
    if (!sku) errors.push("Part number is required.");
    if (!lotNumber) errors.push("Lot / batch number is required.");
    const quantity = parseNumber(raw.quantity ?? "", "Quantity", errors, { min: 0 });
    if (raw.quantity?.trim() === "" || quantity === undefined) {
      if (!errors.some((error) => error.startsWith("Quantity"))) errors.push("Quantity is required.");
    }
    const itemIds = lookups.itemIds as Map<string, number>;
    const itemId = sku ? itemIds.get(sku.toLowerCase()) : undefined;
    if (sku && itemId === undefined) errors.push(`Part "${sku}" doesn't exist yet. Import or add the part first.`);
    let supplierId: number | undefined;
    const supplierText = raw.supplier?.trim();
    if (supplierText) {
      supplierId = (lookups.byName as Map<string, number>).get(supplierText.toLowerCase());
      if (supplierId === undefined) errors.push(`Supplier "${supplierText}" doesn't exist yet.`);
    }
    const expirationDate = parseDate(raw.expirationDate ?? "", "Expiration date", errors);
    const statusText = raw.status?.trim().toLowerCase().replace(/[\s-]+/g, "_");
    const statuses = ["active", "consumed", "scrapped", "returned", "expired"];
    let status = "active";
    if (statusText) {
      if (!statuses.includes(statusText)) errors.push(`Status "${raw.status}" isn't recognized.`);
      else status = statusText;
    }
    const value: LotValue = { sku, itemId: itemId ?? 0, lotNumber, quantity: quantity ?? 0, serialNumber: raw.serialNumber?.trim() || undefined, supplierId, expirationDate, status };
    return { errors, value: errors.length ? undefined : value, identity: joinKey([sku, lotNumber]) };
  },
  async insert(ctx, value) {
    const row = value as LotValue;
    const qty = String(row.quantity);
    const [created] = await ctx.db
      .insert(inventoryLots)
      .values({ itemId: row.itemId, lotNumber: row.lotNumber, serialNumber: row.serialNumber, supplierId: row.supplierId, expirationDate: row.expirationDate, receivedQty: qty, remainingQty: qty, status: row.status })
      .returning();
    await recordAuditTrail(ctx.db, { entityType: "InventoryLot", entityId: created!.id, action: "create", changes: { sku: row.sku, lotNumber: row.lotNumber, source: "data_import" }, performedBy: ctx.userId });
    return { id: created!.id, label: `${row.sku} ${row.lotNumber}` };
  },
  async update(ctx, id, value) {
    const row = value as LotValue;
    const qty = String(row.quantity);
    await ctx.db
      .update(inventoryLots)
      .set({ serialNumber: row.serialNumber, supplierId: row.supplierId, expirationDate: row.expirationDate, receivedQty: qty, remainingQty: qty, status: row.status })
      .where(eq(inventoryLots.id, id));
    await recordAuditTrail(ctx.db, { entityType: "InventoryLot", entityId: id, action: "update", changes: { sku: row.sku, lotNumber: row.lotNumber, source: "data_import" }, performedBy: ctx.userId });
    return { id, label: `${row.sku} ${row.lotNumber}` };
  },
};

// ---------- Calibration equipment ----------

interface EquipmentValue {
  name: string;
  serialNumber?: string;
  location?: string;
  type?: string;
  calibrationIntervalDays: number;
  status: "active" | "inactive" | "out_of_service";
  identity: string;
}

const equipmentEntity: AnyImportEntity = {
  key: "equipment",
  label: "Calibration equipment",
  description: "Gauges and other equipment that need calibration. Matched by serial number when you have one, otherwise by name.",
  fields: [
    { key: "name", label: "Equipment name", required: true, example: "Bench caliper", aliases: ["equipment", "gauge", "instrument", "description"] },
    { key: "serialNumber", label: "Serial number", example: "CAL-100", aliases: ["serial", "sn", "asset", "asset number"] },
    { key: "location", label: "Location", example: "Quality lab", aliases: ["area", "station"] },
    { key: "type", label: "Type", example: "caliper", aliases: ["kind", "category"] },
    { key: "calibrationIntervalDays", label: "Calibration interval (days)", help: "Blank means 365.", example: "365", aliases: ["interval", "frequency", "days"] },
    { key: "status", label: "Status", help: "Active, inactive, or out of service. Blank means active.", example: "active" },
  ],
  identityOf: (raw) => {
    const serial = raw.serialNumber?.trim();
    return serial ? `serial:${serial.toLowerCase()}` : `name:${(raw.name ?? "").trim().toLowerCase()}`;
  },
  async prepare(ctx) {
    const rows = await ctx.db.select({ id: equipment.id, name: equipment.name, serialNumber: equipment.serialNumber }).from(equipment);
    const existing = new Set<string>();
    const ids = new Map<string, number>();
    for (const row of rows) {
      const key = row.serialNumber?.trim() ? `serial:${row.serialNumber.trim().toLowerCase()}` : `name:${row.name.trim().toLowerCase()}`;
      existing.add(key);
      ids.set(key, row.id);
    }
    return { existing, ids };
  },
  validate(raw) {
    const errors: string[] = [];
    const name = raw.name?.trim() ?? "";
    if (!name) errors.push("Equipment name is required.");
    const interval = parseNumber(raw.calibrationIntervalDays ?? "", "Calibration interval", errors, { min: 1, integer: true }) ?? 365;
    const statusText = raw.status?.trim().toLowerCase().replace(/[\s-]+/g, "_");
    let status: EquipmentValue["status"] = "active";
    if (statusText) {
      if (statusText === "active" || statusText === "inactive" || statusText === "out_of_service") status = statusText;
      else errors.push(`Status "${raw.status}" should be active, inactive, or out of service.`);
    }
    const serialNumber = raw.serialNumber?.trim() || undefined;
    const identity = serialNumber ? `serial:${serialNumber.toLowerCase()}` : `name:${name.toLowerCase()}`;
    const value: EquipmentValue = { name, serialNumber, location: raw.location?.trim() || undefined, type: raw.type?.trim() || undefined, calibrationIntervalDays: interval, status, identity };
    return { errors, value: errors.length ? undefined : value, identity };
  },
  async insert(ctx, value) {
    const row = value as EquipmentValue;
    const [created] = await ctx.db
      .insert(equipment)
      .values({ name: row.name, serialNumber: row.serialNumber, location: row.location, type: row.type, calibrationIntervalDays: row.calibrationIntervalDays, status: row.status })
      .returning();
    await recordAuditTrail(ctx.db, { entityType: "Equipment", entityId: created!.id, action: "create", changes: { name: row.name, source: "data_import" }, performedBy: ctx.userId });
    return { id: created!.id, label: row.name };
  },
  async update(ctx, id, value) {
    const row = value as EquipmentValue;
    await ctx.db
      .update(equipment)
      .set({ name: row.name, serialNumber: row.serialNumber, location: row.location, type: row.type, calibrationIntervalDays: row.calibrationIntervalDays, status: row.status })
      .where(eq(equipment.id, id));
    await recordAuditTrail(ctx.db, { entityType: "Equipment", entityId: id, action: "update", changes: { name: row.name, source: "data_import" }, performedBy: ctx.userId });
    return { id, label: row.name };
  },
};

export const QUALITY_IMPORT_ENTITIES = {
  customers: customerEntity,
  supplier_scorecards: scorecardEntity,
  supplier_certifications: certificationEntity,
  inspection_results: inspectionEntity,
  lots: lotEntity,
  equipment: equipmentEntity,
};
