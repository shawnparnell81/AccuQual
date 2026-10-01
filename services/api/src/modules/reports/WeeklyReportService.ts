import type { Db } from "../../lib/requestDb.js";
import { runQualityReport, type RunReportInput } from "./reports.run.js";

/** Last seven days, or the dates the caller passed, using the weekly section list. */
export const WeeklyReportService = {
  kind: "weekly" as const,
  run(db: Db, input: Omit<RunReportInput, "kind">) {
    return runQualityReport(db, { ...input, kind: "weekly" });
  },
};
