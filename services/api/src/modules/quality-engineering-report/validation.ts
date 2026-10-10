import { z } from "zod";
import { zodRecipients } from "../../lib/reportRecipients.js";

const qaItem = z.object({
  problem: z.string().max(4000),
  response: z.string().max(4000),
});

export const saveEngineeringReportSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  narrative: z.object({
    departmentStatus: z.enum(["", "green", "yellow", "red"]),
    primaryAchievement: z.string().max(8000),
    criticalRisk: z.string().max(8000),
    payoutPolicy: z.string().max(8000),
    rca: z.string().max(8000),
    recommendation: z.string().max(8000),
    productAlertNotes: z.string().max(8000),
    quarantineNotes: z.string().max(8000),
    recallsNotes: z.string().max(8000),
    emailIssuesNotes: z.string().max(8000),
    fieldQuestions: z.string().max(8000),
    palletNotes: z.string().max(8000),
    techLine: z.array(qaItem).max(40),
    fitment: z.array(qaItem).max(40),
    productInfo: z.array(qaItem).max(40),
    financialEntries: z
      .array(
        z.object({
          month: z.string().regex(/^\d{4}-\d{2}$/),
          laborAmount: z.string().max(40),
          warrantyAmount: z.string().max(40),
          totalAmount: z.string().max(40),
        }),
      )
      .max(24)
      .optional()
      .default([]),
    importPulls: z
      .array(
        z.object({
          importId: z.number().int().positive(),
          section: z.enum(["returns", "warranty", "labor", "financials"]),
          field: z.string().trim().min(1).max(80),
        }),
      )
      .max(24)
      .optional()
      .default([]),
  }),
  recipients: zodRecipients(0).optional(),
});

export const emailEngineeringReportSchema = saveEngineeringReportSchema.extend({
  recipients: zodRecipients(1),
  narrative: saveEngineeringReportSchema.shape.narrative.optional(),
});
