import type { Request, Response } from "express";
import { and, eq, lt, ne, sql } from "drizzle-orm";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { capa } from "../../drizzle/schema/capa.js";
import { eightD } from "../../drizzle/schema/eightD.js";
import { discrepancyInvestigations } from "../../drizzle/schema/quality.js";
import { complaints } from "../../drizzle/schema/complaints.js";

/**
 * Live badge counts for the nav bar's KPI-flagged items (navConfig.ts's
 * `kpi: true` leaves — see "Subfolder links.xlsx"). Each count is "how many
 * open items need attention", scoped to the caller's tenant:
 *  - ncr/capa/di/complaints: rows whose status isn't "closed"
 *  - eight_d: rows not yet past step 8 (closure)
 * Pareto Analysis and Production Log are KPI-flagged in the sheet too, but
 * aren't countable the same way (Pareto is a chart, not a record list;
 * Production Log is a singleton per-tenant document, not a list) — the nav
 * marks those with a plain KPI indicator instead of a number.
 */
export const getKpiCounts = asyncHandler(async (req: Request, res: Response) => {
  const db = req.db!;

  const ncrSite = req.siteId == null ? sql`false` : eq(ncr.siteId, req.siteId);
  const capaSite = req.siteId == null ? sql`false` : eq(capa.siteId, req.siteId);
  const [ncrOpen, capaOpen, eightDOpen, diOpen, complaintsOpen] = await Promise.all([
    db.select({ id: ncr.id }).from(ncr).where(and(ncrSite, ne(ncr.status, "closed"))),
    db.select({ id: capa.id }).from(capa).where(and(capaSite, ne(capa.status, "closed"))),
    // No status column on 8D — "open" means not yet past D8 (closure).
    db.select({ id: eightD.id }).from(eightD).where(and(lt(eightD.currentStep, 8))),
    db
      .select({ id: discrepancyInvestigations.id })
      .from(discrepancyInvestigations)
      .where(and(ne(discrepancyInvestigations.status, "closed"))),
    db.select({ id: complaints.id }).from(complaints).where(and(ne(complaints.status, "closed"))),
  ]);

  res.json({
    ncr: ncrOpen.length,
    capa: capaOpen.length,
    // Keyed "8d" (not "eight_d") to match the nav leaf's own key in navConfig.ts.
    "8d": eightDOpen.length,
    di: diOpen.length,
    complaints: complaintsOpen.length,
  });
});
