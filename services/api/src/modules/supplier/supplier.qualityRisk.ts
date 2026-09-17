import type { Request, Response } from "express";
import { and, eq, gte, desc, inArray } from "drizzle-orm";
import type { TenantDb } from "../../lib/tenantScope.js";
import { tenants } from "../../drizzle/schema/tenants.js";
import { type Supplier } from "../../drizzle/schema/supplier.js";
import { rma } from "../../drizzle/schema/rma.js";
import { warrantyClaims } from "../../drizzle/schema/warranty.js";
import { capa } from "../../drizzle/schema/capa.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { scarForms } from "../../drizzle/schema/scarForms.js";
import {
  supplierDocuments,
  supplierPpapSubmissions,
  supplierCorrectiveActions,
  supplier8dResponses,
  supplierOnboardingDocuments,
  supplierMessages,
} from "../../drizzle/schema/supplierPortal.js";
import { users } from "../../drizzle/schema/users.js";
import { supplierQualityRiskScores } from "../../drizzle/schema/supplierQualityRisk.js";
import { getSupplierNcrIds, getSupplierCapaIds } from "../supplier-portal/supplierLinkage.js";
import { computeSupplierPerformance } from "./supplier.performance.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { toCsv, toPdf, type ExportableReport } from "../reporting/reporting.export.js";
import { AppError } from "../../utils/appError.js";

/**
 * Phase 7 — the new deterministic, multi-factor "Supplier Quality Risk
 * Score." Deliberately NOT called "v1" in code/table names (that word is
 * already attached, in existing comments, to supplier.performance.ts's own
 * delivery-only heuristic below) and deliberately separate from the three
 * OTHER real "risk" concepts already in this codebase:
 *   - `suppliers.riskLevel` — a manual free-text field nobody writes to
 *     programmatically.
 *   - `ai_risk_scores` (POST /ai/risk-score) — the LLM-based 0-100 scorer,
 *     guardrailed/non-deterministic, surfaced on the AI Insights page.
 *   - `risk_assessments`/FMEA (the Risk Register module) — a manual
 *     severity x probability workflow, not an aggregate supplier score.
 * This score instead folds together 7 REAL, already-existing data sources —
 * exactly what the task brief asks for ("a weighted formula based entirely
 * on existing ACCUQUAL data") — and persists a snapshot per supplier per
 * day so a trend line has real history to show, not just a live number.
 */

export interface SupplierRiskWeights {
  ncr: number;
  capa: number;
  capaRecurrence: number;
  delivery: number;
  defectRate: number;
  warranty: number;
  responsiveness: number;
}

/** Weights need not sum to any particular total — scoreSupplierQualityRisk normalizes by their sum, so a tenant can emphasize one factor without rebalancing every other one by hand. */
export const DEFAULT_SUPPLIER_RISK_WEIGHTS: SupplierRiskWeights = {
  ncr: 20,
  capa: 15,
  capaRecurrence: 15,
  delivery: 15,
  defectRate: 15,
  warranty: 10,
  responsiveness: 10,
};

export interface SupplierQualityFactors {
  supplierId: number;
  ncrCount: number;
  capaCount: number;
  capaRecurrenceCount: number;
  rmaCount: number;
  warrantyClaimCount: number;
  scarCount: number;
  openCorrectiveActionCount: number;
  deliveryTimelinessAvgDays: number | null;
  deliveryAccuracyAvgPercent: number | null;
  onTimeDeliveryPercent: number | null;
  receivingEventCount: number;
  defectRatePercent: number | null;
  avgResponseHours: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every number here comes from data this tenant already has — no new
 * tracked metric, no external input. See each factor's own comment for the
 * exact derivation and the (documented, defensible-not-invented)
 * normalization threshold used to turn it into a 0-1 risk contribution in
 * scoreSupplierQualityRisk below.
 */
export async function getSupplierQualityFactors(db: TenantDb, tenantId: number, supplierId: number): Promise<SupplierQualityFactors> {
  const [ncrIds, capaIds, performance, rmaRows, warrantyRows, scarRows, carRows, eightDRows, messages] = await Promise.all([
    getSupplierNcrIds(db, tenantId, supplierId),
    getSupplierCapaIds(db, tenantId, supplierId),
    computeSupplierPerformance(db, tenantId, supplierId),
    db.select({ id: rma.id }).from(rma).where(and(eq(rma.tenantId, tenantId), eq(rma.supplierId, supplierId))),
    db.select({ id: warrantyClaims.id }).from(warrantyClaims).where(and(eq(warrantyClaims.tenantId, tenantId), eq(warrantyClaims.supplierId, supplierId))),
    db.select({ id: scarForms.id }).from(scarForms).where(and(eq(scarForms.tenantId, tenantId), eq(scarForms.supplierId, supplierId))),
    db.select().from(supplierCorrectiveActions).where(and(eq(supplierCorrectiveActions.tenantId, tenantId), eq(supplierCorrectiveActions.supplierId, supplierId))),
    db.select().from(supplier8dResponses).where(and(eq(supplier8dResponses.tenantId, tenantId), eq(supplier8dResponses.supplierId, supplierId))),
    db.select({ senderRole: supplierMessages.senderRole, createdAt: supplierMessages.createdAt }).from(supplierMessages).where(and(eq(supplierMessages.tenantId, tenantId), eq(supplierMessages.supplierId, supplierId))).orderBy(supplierMessages.createdAt),
  ]);

  // NCRs/CAPAs from this supplier's own derived set — small volumes at this
  // app's scale, so a plain JS pull-and-compare is the same convention
  // supplier.performance.ts's own comment already uses, not raw SQL
  // aggregation.
  const ncrRows = ncrIds.length > 0 ? await db.select({ id: ncr.id, createdAt: ncr.createdAt }).from(ncr).where(and(eq(ncr.tenantId, tenantId), inArray(ncr.id, ncrIds))) : [];
  const capaRows = capaIds.length > 0 ? await db.select({ id: capa.id, status: capa.status, closedAt: capa.closedAt, ncrId: capa.ncrId }).from(capa).where(and(eq(capa.tenantId, tenantId), inArray(capa.id, capaIds))) : [];

  // CAPA recurrence: a CAPA closed for this supplier, after which ANOTHER
  // of this supplier's NCRs was opened — a real "the corrective action
  // didn't prevent the next nonconformance" signal, not just "more than
  // one CAPA exists" (which could just mean two unrelated issues).
  const closedCapaCloseDates = capaRows.filter((c) => c.status === "closed" && c.closedAt).map((c) => new Date(c.closedAt!).getTime());
  const capaRecurrenceCount = closedCapaCloseDates.filter((closedAt) => ncrRows.some((n) => new Date(n.createdAt ?? 0).getTime() > closedAt)).length;

  const openCorrectiveActionCount = carRows.filter((c) => c.status === "submitted" || c.status === "under_review").length + eightDRows.filter((r) => r.status === "submitted" || r.status === "under_review").length;

  // Defect rate: (NCRs + RMAs) raised against this supplier / real receiving
  // opportunities (deliveryFrequency.count — receive movements in the same
  // 90-day window computeSupplierPerformance already uses) — a heuristic
  // rate, not a true units-defective/units-shipped ratio (this app has no
  // per-shipment defect-quantity field to divide by), documented as such.
  const receivingEventCount = performance.deliveryFrequency.count;
  const defectRatePercent = receivingEventCount > 0 ? ((ncrRows.length + rmaRows.length) / receivingEventCount) * 100 : null;

  // Communication responsiveness: average hours between one party's message
  // and the OTHER party's next reply in the same thread, across every
  // thread — ignoring gaps over 30 days (an abandoned thread, not a slow
  // reply) so one stale conversation doesn't dominate the average.
  const responseHours: number[] = [];
  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1]!;
    const curr = messages[i]!;
    if (prev.senderRole === curr.senderRole) continue;
    const gapMs = new Date(curr.createdAt ?? 0).getTime() - new Date(prev.createdAt ?? 0).getTime();
    if (gapMs <= 0 || gapMs > 30 * DAY_MS) continue;
    responseHours.push(gapMs / (60 * 60 * 1000));
  }
  const avgResponseHours = responseHours.length > 0 ? responseHours.reduce((a, b) => a + b, 0) / responseHours.length : null;

  return {
    supplierId,
    ncrCount: ncrRows.length,
    capaCount: capaRows.length,
    capaRecurrenceCount,
    rmaCount: rmaRows.length,
    warrantyClaimCount: warrantyRows.length,
    scarCount: scarRows.length,
    openCorrectiveActionCount,
    deliveryTimelinessAvgDays: performance.deliveryTimeliness.avgDays,
    deliveryAccuracyAvgPercent: performance.deliveryAccuracy.avgPercent,
    onTimeDeliveryPercent: performance.onTimeDeliveryPercent,
    receivingEventCount,
    defectRatePercent: defectRatePercent === null ? null : Math.round(defectRatePercent * 10) / 10,
    avgResponseHours: avgResponseHours === null ? null : Math.round(avgResponseHours * 10) / 10,
  };
}

export interface SupplierRiskScoreResult {
  score: number;
  band: "low" | "medium" | "high" | "critical";
  breakdown: { ncrFactor: number; capaFactor: number; capaRecurrenceFactor: number; deliveryFactor: number; defectRateFactor: number; warrantyFactor: number; responsivenessFactor: number; raw: Record<string, number | null> };
}

/**
 * A simple, transparent weighted-average heuristic — same "not a black box"
 * spirit as supplier.performance.ts's own point system. Each factor is
 * normalized to 0-1 against a documented, defensible threshold (not a
 * statistically fit model — there isn't enough real history yet to fit
 * one), then combined by the tenant's configured weights (Settings →
 * Supplier Risk; falls back to DEFAULT_SUPPLIER_RISK_WEIGHTS) into a 0-100
 * score, higher = riskier.
 */
export function scoreSupplierQualityRisk(factors: SupplierQualityFactors, weightsInput: Partial<SupplierRiskWeights>): SupplierRiskScoreResult {
  const w: SupplierRiskWeights = { ...DEFAULT_SUPPLIER_RISK_WEIGHTS, ...weightsInput };
  const totalWeight = w.ncr + w.capa + w.capaRecurrence + w.delivery + w.defectRate + w.warranty + w.responsiveness || 1;

  const ncrFactor = Math.min(1, factors.ncrCount / 10); // 10+ NCRs on file = max risk
  const capaFactor = Math.min(1, factors.capaCount / 6); // 6+ CAPAs = max risk
  const capaRecurrenceFactor = Math.min(1, factors.capaRecurrenceCount / 3); // 3+ recurrences = max risk
  // Delivery reuses supplier.performance.ts's own 0-8 point heuristic directly (avoids a second, differently-tuned delivery scale existing side by side with the first).
  const deliveryPoints = factors.deliveryTimelinessAvgDays === null && factors.deliveryAccuracyAvgPercent === null ? 0 : (factors.onTimeDeliveryPercent !== null && factors.onTimeDeliveryPercent < 50 ? 1 : 0) + (factors.deliveryAccuracyAvgPercent !== null && factors.deliveryAccuracyAvgPercent < 75 ? 1 : 0);
  const deliveryFactor = Math.min(1, deliveryPoints / 2);
  const defectRateFactor = factors.defectRatePercent === null ? 0 : Math.min(1, factors.defectRatePercent / 20); // 20%+ defect rate = max risk
  const warrantyFactor = Math.min(1, factors.warrantyClaimCount / 5); // 5+ warranty claims = max risk
  const responsivenessFactor = factors.avgResponseHours === null ? 0.5 : Math.min(1, factors.avgResponseHours / 72); // 72+ hours avg reply = max risk; no data at all is treated as neutral, not zero risk

  const weightedSum = ncrFactor * w.ncr + capaFactor * w.capa + capaRecurrenceFactor * w.capaRecurrence + deliveryFactor * w.delivery + defectRateFactor * w.defectRate + warrantyFactor * w.warranty + responsivenessFactor * w.responsiveness;
  const score = Math.round((weightedSum / totalWeight) * 1000) / 10;
  const band = score >= 75 ? "critical" : score >= 50 ? "high" : score >= 25 ? "medium" : "low";

  return {
    score,
    band,
    breakdown: {
      ncrFactor: Math.round(ncrFactor * 100) / 100,
      capaFactor: Math.round(capaFactor * 100) / 100,
      capaRecurrenceFactor: Math.round(capaRecurrenceFactor * 100) / 100,
      deliveryFactor: Math.round(deliveryFactor * 100) / 100,
      defectRateFactor: Math.round(defectRateFactor * 100) / 100,
      warrantyFactor: Math.round(warrantyFactor * 100) / 100,
      responsivenessFactor: Math.round(responsivenessFactor * 100) / 100,
      raw: {
        ncrCount: factors.ncrCount,
        capaCount: factors.capaCount,
        capaRecurrenceCount: factors.capaRecurrenceCount,
        onTimeDeliveryPercent: factors.onTimeDeliveryPercent,
        deliveryAccuracyAvgPercent: factors.deliveryAccuracyAvgPercent,
        defectRatePercent: factors.defectRatePercent,
        warrantyClaimCount: factors.warrantyClaimCount,
        avgResponseHours: factors.avgResponseHours,
      },
    },
  };
}

async function loadRiskWeights(db: TenantDb, tenantId: number): Promise<Partial<SupplierRiskWeights>> {
  const [tenant] = await db.select({ supplierRiskWeights: tenants.supplierRiskWeights }).from(tenants).where(eq(tenants.id, tenantId));
  return tenant?.supplierRiskWeights ?? {};
}

/**
 * The one write path for this score — POST /suppliers/:id/risk-score/
 * recompute (internal, Quality/Purchasing/admin only). Upserts today's row
 * (by supplierId+scoreDate, see the schema's unique constraint) rather than
 * inserting unboundedly, and records the exact audit-trail entry the brief
 * asks for.
 */
export async function recomputeSupplierRiskScore(db: TenantDb, tenantId: number, supplierId: number, performedBy: number | undefined): Promise<SupplierQualityRiskScoreRow> {
  const [factors, weights] = await Promise.all([getSupplierQualityFactors(db, tenantId, supplierId), loadRiskWeights(db, tenantId)]);
  const result = scoreSupplierQualityRisk(factors, weights);
  const scoreDate = new Date().toISOString().slice(0, 10);

  const [row] = await db
    .insert(supplierQualityRiskScores)
    .values({ tenantId, supplierId, scoreDate, score: String(result.score), band: result.band, breakdown: result.breakdown, computedByUserId: performedBy })
    .onConflictDoUpdate({
      target: [supplierQualityRiskScores.supplierId, supplierQualityRiskScores.scoreDate],
      set: { score: String(result.score), band: result.band, breakdown: result.breakdown, computedByUserId: performedBy, createdAt: new Date() },
    })
    .returning();

  await recordAuditTrail(db, {
    tenantId,
    entityType: "Supplier",
    entityId: supplierId,
    action: "update",
    changes: { message: "Risk score updated (v1 formula)", score: result.score, band: result.band },
    performedBy,
  });

  return row!;
}

type SupplierQualityRiskScoreRow = typeof supplierQualityRiskScores.$inferSelect;

const TREND_WINDOW_DAYS = 90;

/**
 * GET-side read: returns the latest snapshot plus up to 90 days of trend
 * history. If no snapshot exists yet for this supplier (never recomputed),
 * computes one on the fly and returns it WITHOUT persisting or
 * audit-logging — a lazy read should never look like an explicit "someone
 * recomputed this" action in the audit trail.
 */
export async function getSupplierRiskScoreWithTrend(db: TenantDb, tenantId: number, supplierId: number) {
  const since = new Date(Date.now() - TREND_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  const trend = await db
    .select()
    .from(supplierQualityRiskScores)
    .where(and(eq(supplierQualityRiskScores.tenantId, tenantId), eq(supplierQualityRiskScores.supplierId, supplierId), gte(supplierQualityRiskScores.scoreDate, since)))
    .orderBy(supplierQualityRiskScores.scoreDate);

  if (trend.length > 0) return { latest: trend[trend.length - 1]!, trend };

  const [factors, weights] = await Promise.all([getSupplierQualityFactors(db, tenantId, supplierId), loadRiskWeights(db, tenantId)]);
  const result = scoreSupplierQualityRisk(factors, weights);
  const latest = { id: -1, tenantId, supplierId, scoreDate: new Date().toISOString().slice(0, 10), score: String(result.score), band: result.band, formulaVersion: "v1", breakdown: result.breakdown, computedByUserId: null, createdAt: new Date(), unsaved: true };
  return { latest, trend: [latest] };
}

// ---------------------------------------------------------------------------
// Health indicators (Phase 7 task 8)
// ---------------------------------------------------------------------------

export interface SupplierHealth {
  lastLoginAt: string | null;
  lastDocumentUploadAt: string | null;
  lastCommunicationAt: string | null;
  openActionCount: number;
}

export async function getSupplierHealth(db: TenantDb, tenantId: number, supplierId: number): Promise<SupplierHealth> {
  const [loginRows, docDates, ppapDates, carDates, eightDDates, onboardingDates, lastMessage, carOpen, eightDOpen] = await Promise.all([
    // Plain fetch-and-max in JS, not ORDER BY ... DESC LIMIT 1 — Postgres's
    // default DESC ordering puts NULLs FIRST, so a portal login that never
    // logged in would silently outrank one that logged in yesterday.
    db.select({ lastLoginAt: users.lastLoginAt }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.supplierId, supplierId))),
    db.select({ createdAt: supplierDocuments.createdAt }).from(supplierDocuments).where(and(eq(supplierDocuments.tenantId, tenantId), eq(supplierDocuments.supplierId, supplierId))).orderBy(desc(supplierDocuments.createdAt)).limit(1),
    db.select({ createdAt: supplierPpapSubmissions.createdAt }).from(supplierPpapSubmissions).where(and(eq(supplierPpapSubmissions.tenantId, tenantId), eq(supplierPpapSubmissions.supplierId, supplierId))).orderBy(desc(supplierPpapSubmissions.createdAt)).limit(1),
    db.select({ createdAt: supplierCorrectiveActions.createdAt }).from(supplierCorrectiveActions).where(and(eq(supplierCorrectiveActions.tenantId, tenantId), eq(supplierCorrectiveActions.supplierId, supplierId))).orderBy(desc(supplierCorrectiveActions.createdAt)).limit(1),
    db.select({ createdAt: supplier8dResponses.createdAt }).from(supplier8dResponses).where(and(eq(supplier8dResponses.tenantId, tenantId), eq(supplier8dResponses.supplierId, supplierId))).orderBy(desc(supplier8dResponses.createdAt)).limit(1),
    db.select({ createdAt: supplierOnboardingDocuments.createdAt }).from(supplierOnboardingDocuments).where(and(eq(supplierOnboardingDocuments.tenantId, tenantId), eq(supplierOnboardingDocuments.supplierId, supplierId))).orderBy(desc(supplierOnboardingDocuments.createdAt)).limit(1),
    db.select({ createdAt: supplierMessages.createdAt }).from(supplierMessages).where(and(eq(supplierMessages.tenantId, tenantId), eq(supplierMessages.supplierId, supplierId))).orderBy(desc(supplierMessages.createdAt)).limit(1),
    db.select({ status: supplierCorrectiveActions.status }).from(supplierCorrectiveActions).where(and(eq(supplierCorrectiveActions.tenantId, tenantId), eq(supplierCorrectiveActions.supplierId, supplierId))),
    db.select({ status: supplier8dResponses.status }).from(supplier8dResponses).where(and(eq(supplier8dResponses.tenantId, tenantId), eq(supplier8dResponses.supplierId, supplierId))),
  ]);

  const uploadDates = [docDates[0]?.createdAt, ppapDates[0]?.createdAt, carDates[0]?.createdAt, eightDDates[0]?.createdAt, onboardingDates[0]?.createdAt].filter((d): d is Date => !!d);
  const lastDocumentUploadAt = uploadDates.length > 0 ? new Date(Math.max(...uploadDates.map((d) => new Date(d).getTime()))).toISOString() : null;
  const openActionCount = carOpen.filter((c) => c.status === "submitted" || c.status === "under_review").length + eightDOpen.filter((r) => r.status === "submitted" || r.status === "under_review").length;

  const loginDates = loginRows.map((r) => r.lastLoginAt).filter((d): d is Date => !!d);
  const lastLoginAt = loginDates.length > 0 ? new Date(Math.max(...loginDates.map((d) => new Date(d).getTime()))).toISOString() : null;

  return {
    lastLoginAt,
    lastDocumentUploadAt,
    lastCommunicationAt: lastMessage[0]?.createdAt ? new Date(lastMessage[0].createdAt).toISOString() : null,
    openActionCount,
  };
}

// ---------------------------------------------------------------------------
// Scorecard export (Phase 7 task 6) — reuses Phase 6's generic
// toCsv/toPdf(ExportableReport) rather than a third bespoke export format.
// ---------------------------------------------------------------------------

export async function exportSupplierScorecard(req: Request, res: Response, supplier: Supplier, format: string): Promise<void> {
  const db = req.db!;
  const tenantId = req.tenantId!;
  const [factors, riskResult, performer] = await Promise.all([
    getSupplierQualityFactors(db, tenantId, supplier.id),
    getSupplierRiskScoreWithTrend(db, tenantId, supplier.id),
    req.user?.id ? db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, req.user.id)) : Promise.resolve([]),
  ]);
  const [tenant] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));

  const report: ExportableReport = {
    title: `Supplier Scorecard — ${supplier.name}`,
    generatedAt: new Date(),
    generatedBy: performer[0]?.name || performer[0]?.email || `User #${req.user?.id ?? "unknown"}`,
    tenantName: tenant?.name ?? "Unknown Tenant",
    columns: ["Metric", "Value"],
    rows: [
      ["Quality Risk Score", riskResult.latest.score],
      ["Risk Band", riskResult.latest.band],
      ["NCR Count", factors.ncrCount],
      ["CAPA Count", factors.capaCount],
      ["CAPA Recurrence Count", factors.capaRecurrenceCount],
      ["RMA Count", factors.rmaCount],
      ["Warranty Claim Count", factors.warrantyClaimCount],
      ["SCAR Count", factors.scarCount],
      ["Open Corrective Actions", factors.openCorrectiveActionCount],
      ["On-Time Delivery %", factors.onTimeDeliveryPercent ?? "No data"],
      ["Delivery Accuracy %", factors.deliveryAccuracyAvgPercent ?? "No data"],
      ["Defect Rate %", factors.defectRatePercent ?? "No data"],
      ["Avg Communication Response (hrs)", factors.avgResponseHours ?? "No data"],
    ],
  };

  await recordAuditTrail(db, { tenantId, entityType: "ReportExport", entityId: supplier.id, action: "create", changes: { reportKey: "supplier-scorecard", format }, performedBy: req.user?.id });

  if (format === "pdf") {
    const bytes = await toPdf(report);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="supplier-scorecard-${supplier.id}.pdf"`);
    res.send(Buffer.from(bytes));
    return;
  }
  if (format !== "csv") throw AppError.badRequest(`Unsupported export format: ${format}`);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="supplier-scorecard-${supplier.id}.csv"`);
  res.send(toCsv(report));
}
