import type { ImportPull, ImportSourceRows } from "../import/import.archive.js";
import type { ImportedMonthTotals } from "./model.js";
import { parseMonthKey, parseNumber } from "./supplierParse.js";

const FIGURE: Record<ImportPull["section"], "labor" | "parts" | "total" | "claims"> = {
  labor: "labor",
  warranty: "parts",
  financials: "total",
  returns: "claims",
};

/**
 * Totals of each chosen import field, split by the month in the row's Report date.
 * A row without a readable date is left out: it is never guessed into the report's own month
 * (that would fill a month that has no data of its own). Months outside the report's six-month window are dropped.
 */
export function importedMonthTotals(pulls: ImportPull[], sources: ImportSourceRows[], months: string[], _reportMonth: string): ImportedMonthTotals {
  const window = new Set(months);
  const byId = new Map(sources.map((source) => [source.importId, source]));
  const out: ImportedMonthTotals = {};
  for (const pull of pulls) {
    const source = byId.get(pull.importId);
    if (!source) continue;
    const figure = FIGURE[pull.section];
    for (const row of source.rows) {
      const amount = parseNumber(row.mapped[pull.field] ?? "");
      if (amount == null) continue;
      const month = parseMonthKey(row.mapped.report_date ?? "");
      if (!month || !window.has(month)) continue;
      const slot = (out[month] ??= { total: null, parts: null, labor: null, claims: null });
      slot[figure] = Math.round(((slot[figure] ?? 0) + amount) * 100) / 100;
    }
  }
  return out;
}
