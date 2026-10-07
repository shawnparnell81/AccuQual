import { describe, expect, it } from "vitest";
import { addRecipient, normalizeReportRecipients, readStoredRecipients } from "./reportRecipients.js";
import { createReportScheduleSchema, updateReportScheduleSchema } from "../modules/reporting/reporting.validation.js";
import { emailEngineeringReportSchema, saveEngineeringReportSchema } from "../modules/quality-engineering-report/validation.js";

const narrative = {
  departmentStatus: "green" as const,
  primaryAchievement: "Closed the line.",
  criticalRisk: "",
  payoutPolicy: "",
  rca: "",
  recommendation: "",
  productAlertNotes: "",
  quarantineNotes: "",
  recallsNotes: "",
  emailIssuesNotes: "",
  fieldQuestions: "",
  palletNotes: "",
  techLine: [],
  fitment: [],
  productInfo: [],
};

describe("report recipient lists", () => {
  it("normalizes case and duplicates", () => {
    expect(normalizeReportRecipients(["  QM@test.local ", "qm@test.local", ""])).toEqual({
      ok: true,
      emails: ["qm@test.local"],
    });
    expect(readStoredRecipients([" QM@test.local ", "nope", 4, "qm@test.local"])).toEqual(["qm@test.local"]);
  });

  it("rejects a bad address and caps the list", () => {
    expect(normalizeReportRecipients(["not-an-email"]).ok).toBe(false);
    expect(normalizeReportRecipients(Array.from({ length: 41 }, (_, index) => `p${index}@test.local`)).ok).toBe(false);
    expect(addRecipient(["qm@test.local"], "QM@test.local").ok).toBe(false);
  });

  it("keeps a schedule list required and a saved report list optional", () => {
    expect(
      createReportScheduleSchema.parse({
        reportType: "ncr_summary",
        frequency: "weekly",
        recipients: [" QM@test.local ", "qm@test.local"],
      }).recipients,
    ).toEqual(["qm@test.local"]);
    expect(() => updateReportScheduleSchema.parse({ recipients: [] })).toThrow(/at least one/i);
    expect(updateReportScheduleSchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(saveEngineeringReportSchema.parse({ year: 2026, month: 8, narrative, recipients: [" Ada@Plant.com ", "ada@plant.com"] }).recipients).toEqual([
      "ada@plant.com",
    ]);
    expect(saveEngineeringReportSchema.parse({ year: 2026, month: 8, narrative }).recipients).toBeUndefined();
    expect(emailEngineeringReportSchema.parse({ year: 2026, month: 8, recipients: ["ada@plant.com"] }).recipients).toEqual(["ada@plant.com"]);
    expect(() => emailEngineeringReportSchema.parse({ year: 2026, month: 8, recipients: [] })).toThrow(/at least one/i);
  });
});
