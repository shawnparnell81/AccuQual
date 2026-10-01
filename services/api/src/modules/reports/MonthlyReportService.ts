import type { Db } from "../../lib/requestDb.js";
import { runQualityReport, type RunReportInput } from "./reports.run.js";

/** The calendar month so far, plus training, calibration, PPAP, and cycle time. */
export const MonthlyReportService = {
  kind: "monthly" as const,
  run(db: Db, input: Omit<RunReportInput, "kind">) {
    return runQualityReport(db, { ...input, kind: "monthly" });
  },
};
