import { z } from "zod";
import { REPORT_TYPES } from "./reporting.templates.js";

export const createReportScheduleSchema = z.object({
  reportType: z.enum(REPORT_TYPES),
  frequency: z.enum(["daily", "weekly", "monthly"]),
  recipients: z.array(z.string().email()).min(1),
  enabled: z.boolean().optional(),
});

export const updateReportScheduleSchema = createReportScheduleSchema.partial();

export const reportSummarySchema = z.object({
  kind: z.enum(["quality_trends", "supplier_risk_changes", "warranty_patterns", "production_deviations"]),
});
