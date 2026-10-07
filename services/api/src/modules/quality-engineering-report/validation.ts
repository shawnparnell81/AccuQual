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
  }),
  recipients: zodRecipients(0).optional(),
});

export const emailEngineeringReportSchema = saveEngineeringReportSchema.extend({
  recipients: zodRecipients(1),
  narrative: saveEngineeringReportSchema.shape.narrative.optional(),
});
