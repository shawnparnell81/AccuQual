import type { Db } from "../../lib/requestDb.js";
import { runQualityReport, type RunReportInput } from "./reports.run.js";

/** A caller-chosen date range. Uses the full monthly section list. */
export const AdHocReportService = {
  kind: "adhoc" as const,
  run(db: Db, input: Omit<RunReportInput, "kind">) {
    return runQualityReport(db, { ...input, kind: "adhoc" });
  },
};
