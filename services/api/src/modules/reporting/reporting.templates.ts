import * as reportingService from "./reporting.service.js";
import type { Db } from "../../lib/requestDb.js";

export const REPORT_TYPES = ["ncr_summary", "capa_summary", "supplier_scorecard", "warranty_summary", "receiving_summary"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  ncr_summary: "NCR Summary",
  capa_summary: "CAPA Summary",
  supplier_scorecard: "Supplier Scorecard",
  warranty_summary: "Warranty / RMA Summary",
  receiving_summary: "Receiving Inspection Summary",
};

/**
 * Phase 6 report templates — plain subject/body text, the same shape
 * notification.service.ts's sendEmail() already takes (see
 * notifications/templates.ts's own {{token}} engine for FIXED, repeated
 * emails; these are report bodies built fresh from live data every send,
 * so a static template has nothing to substitute into — same reasoning
 * Phase 5's AI-drafted supplier email used for not forcing drafted content
 * through that token system either).
 */
export async function buildReportEmail(db: Db, reportType: ReportType, companyName: string): Promise<{ subject: string; body: string }> {
  const today = new Date().toISOString().slice(0, 10);

  switch (reportType) {
    case "ncr_summary": {
      const m = await reportingService.getNcrMetrics(db);
      return {
        subject: `${companyName} — NCR Summary (${today})`,
        body:
          `NCR Summary as of ${today}\n\n` +
          `Open: ${m.totalOpen}\nClosed: ${m.totalClosed}\n` +
          `Average closure time: ${m.avgClosureDays ?? "n/a"} days\n\n` +
          `By severity:\n${m.bySeverity.map((s) => `  ${s.severity}: ${s.count}`).join("\n")}\n\n` +
          `By status:\n${m.byStatus.map((s) => `  ${s.status}: ${s.count}`).join("\n")}\n`,
      };
    }
    case "capa_summary": {
      const m = await reportingService.getCapaMetrics(db);
      return {
        subject: `${companyName} — CAPA Summary (${today})`,
        body:
          `CAPA Summary as of ${today}\n\n` +
          `Total: ${m.total}\nClosed: ${m.closed}\nEffectiveness (closure rate): ${m.effectivenessRate}%\n` +
          `Average closure time: ${m.avgClosureDays ?? "n/a"} days\n\n` +
          `By status:\n${m.byStatus.map((s) => `  ${s.status}: ${s.count}`).join("\n")}\n`,
      };
    }
    case "supplier_scorecard": {
      const r = await reportingService.getSupplierPerformanceReport(db);
      return {
        subject: `${companyName} — Supplier Scorecard (${today})`,
        body:
          `Supplier Scorecard as of ${today}\n\n` +
          `Risk distribution:\n${r.riskDistribution.map((d) => `  ${d.riskScore}: ${d.count}`).join("\n")}\n\n` +
          `Suppliers:\n${r.suppliers.map((s) => `  ${s.name} — risk: ${s.riskScore}, avg delivery: ${s.onTimeAvgDays ?? "n/a"}d, accuracy: ${s.accuracyAvgPercent ?? "n/a"}%`).join("\n")}\n`,
      };
    }
    case "warranty_summary": {
      const m = await reportingService.getWarrantyTrends(db);
      return {
        subject: `${companyName} — Warranty / RMA Summary (${today})`,
        body:
          `Warranty / RMA Summary as of ${today}\n\n` +
          `Total claims: ${m.total}\nTotal actual cost: $${m.totalActualCost.toFixed(2)}\n\n` +
          `By status:\n${m.byStatus.map((s) => `  ${s.status}: ${s.count}`).join("\n")}\n`,
      };
    }
    case "receiving_summary": {
      const m = await reportingService.getReceivingTrends(db);
      return {
        subject: `${companyName} — Receiving Inspection Summary (${today})`,
        body:
          `Receiving Inspection Summary as of ${today}\n\n` +
          `Total incoming inspections: ${m.total}\nAccept rate: ${m.acceptRate ?? "n/a"}%\n\n` +
          `By final status:\n${m.byFinalStatus.map((s) => `  ${s.status}: ${s.count}`).join("\n")}\n`,
      };
    }
  }
}
