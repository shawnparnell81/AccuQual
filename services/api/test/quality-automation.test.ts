import { describe, expect, it } from "vitest";
import { normalizeNotificationPreferences } from "../src/modules/notifications/notification.service.js";
import { updateQualityAutomationSettingsSchema } from "../src/modules/settings/settings.validation.js";
import {
  DEFAULT_QUALITY_AUTOMATION,
  calendarDaysUntil,
  canDecideApproval,
  classifyDue,
  descriptionsSimilar,
  eightDDueDate,
  eightDIsClosed,
  escalationRecipients,
  findRepeatCluster,
  normalizePart,
  noticeCopy,
  recordHref,
  renderNoticeEmail,
  resolveQualityAutomationSettings,
  sameIssue,
  signalsFromNcr,
  type EscalationPerson,
  type RepeatSignals,
} from "../src/modules/quality-automation/logic.js";

const NOW = new Date("2026-09-27T15:00:00.000Z");
const TZ = "UTC";

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * 86_400_000);
}

function signal(partial: Partial<RepeatSignals> & Pick<RepeatSignals, "id">): RepeatSignals {
  return {
    createdAt: NOW,
    part: null,
    supplierId: null,
    defectCode: null,
    description: "",
    title: `NCR #${partial.id}`,
    ...partial,
  };
}

const people: EscalationPerson[] = [
  { id: 1, email: "owner@plant.example", isActive: true, managerId: 2, roleName: "quality_engineer", department: "quality" },
  { id: 2, email: "manager@plant.example", isActive: true, managerId: null, roleName: "supervisor", department: "production" },
  { id: 3, email: "qm@plant.example", isActive: true, managerId: null, roleName: "quality_manager", department: "quality" },
  { id: 4, email: "inactive-manager@plant.example", isActive: false, managerId: null, roleName: "quality_manager", department: "quality" },
  { id: 5, email: "inspector@plant.example", isActive: true, managerId: null, roleName: "inspector", department: "quality" },
];

describe("quality automation settings", () => {
  it("fills missing values with the documented defaults", () => {
    expect(resolveQualityAutomationSettings(null)).toEqual(DEFAULT_QUALITY_AUTOMATION);
    expect(resolveQualityAutomationSettings({ remindDaysBeforeDue: 1 })).toMatchObject({
      remindDaysBeforeDue: 1,
      escalateAfterDaysOverdue: 7,
      stuckDays: 14,
      approvalStuckDays: 3,
      repeatNcrWindowDays: 90,
      repeatNcrThreshold: 3,
    });
  });

  it("rejects thresholds outside the admin form ranges", () => {
    expect(updateQualityAutomationSettingsSchema.safeParse({ remindDaysBeforeDue: 31 }).success).toBe(false);
    expect(updateQualityAutomationSettingsSchema.safeParse({ repeatNcrThreshold: 1 }).success).toBe(false);
    expect(updateQualityAutomationSettingsSchema.safeParse({ escalateAfterDaysOverdue: 7, repeatNcrWindowDays: 90 }).success).toBe(true);
  });
});

describe("due-date classification", () => {
  const settings = { remindDaysBeforeDue: 3, escalateAfterDaysOverdue: 7 };

  it("reminds inside the window, on the due date, and escalates after the overdue threshold", () => {
    expect(classifyDue(daysFromNow(3), NOW, settings, TZ)).toBe("due_soon");
    expect(classifyDue(daysFromNow(4), NOW, settings, TZ)).toBeNull();
    expect(classifyDue(daysFromNow(0), NOW, settings, TZ)).toBe("due_today");
    expect(classifyDue(daysFromNow(-1), NOW, settings, TZ)).toBe("overdue");
    expect(classifyDue(daysFromNow(-7), NOW, settings, TZ)).toBe("escalated");
  });

  it("counts calendar days in the company time zone", () => {
    const evening = new Date("2026-09-28T03:30:00.000Z");
    const due = new Date("2026-09-28T04:30:00.000Z");
    expect(calendarDaysUntil(due, evening, "America/New_York")).toBe(1);
    expect(calendarDaysUntil(due, evening, "UTC")).toBe(0);
  });
});

describe("escalation recipients", () => {
  it("uses the owner's active manager", () => {
    expect(escalationRecipients(1, people)).toEqual(["manager@plant.example"]);
  });

  it("falls back to quality managers when the manager is missing or inactive", () => {
    expect(escalationRecipients(9, people)).toEqual(["qm@plant.example"]);
    expect(escalationRecipients(5, [{ ...people[4]!, managerId: 4 }, ...people])).toEqual(["qm@plant.example"]);
  });

  it("falls back to the quality department when no quality manager is active", () => {
    const withoutManagers = people.filter((person) => person.roleName !== "quality_manager");
    expect(escalationRecipients(null, withoutManagers).sort()).toEqual(["inspector@plant.example", "owner@plant.example"]);
  });
});

describe("approvals", () => {
  it("lets an admin, the named role, or the named department decide", () => {
    expect(canDecideApproval({ roleName: "admin", department: "it" }, { approverRole: "quality_manager" })).toBe(true);
    expect(canDecideApproval({ roleName: "quality_manager", department: "quality" }, { approverRole: "quality_manager" })).toBe(true);
    expect(canDecideApproval({ roleName: "inspector", department: "quality" }, { approverDepartment: "quality" })).toBe(true);
    expect(canDecideApproval({ roleName: "inspector", department: "production" }, { approverRole: "quality_manager", approverDepartment: "quality" })).toBe(false);
  });
});

describe("repeat NCRs", () => {
  it("matches the same part, or the same supplier plus defect code, or a similar description", () => {
    const subject = signal({ id: 1, part: "pn-100", supplierId: 9, defectCode: "Dimensional", description: "scratch on the bore of the housing" });
    expect(sameIssue(subject, signal({ id: 2, part: "pn-100" }))).toBe(true);
    expect(sameIssue(subject, signal({ id: 3, supplierId: 9, defectCode: "Dimensional" }))).toBe(true);
    expect(sameIssue(subject, signal({ id: 4, supplierId: 9, defectCode: "Visual" }))).toBe(false);
    expect(sameIssue(subject, signal({ id: 5, description: "scratch on the bore of the housing after grind" }))).toBe(true);
    expect(descriptionsSimilar("short note", "short note again")).toBe(false);
  });

  it("needs the threshold inside the window and ignores older matches", () => {
    const records = [
      signal({ id: 10, part: "pn-100", createdAt: daysFromNow(-10) }),
      signal({ id: 11, part: "pn-100", createdAt: daysFromNow(-20) }),
      signal({ id: 14, part: "pn-100", createdAt: daysFromNow(-5) }),
      signal({ id: 12, part: "pn-100", createdAt: daysFromNow(-120) }),
      signal({ id: 13, part: "other", createdAt: daysFromNow(-1) }),
    ];
    expect(findRepeatCluster(records, 10, 90, 3, NOW).map((row) => row.id)).toEqual([14, 10, 11]);
    expect(findRepeatCluster(records, 10, 90, 4, NOW)).toEqual([]);
    expect(findRepeatCluster(records, 13, 90, 3, NOW)).toEqual([]);
  });

  it("reads the part and defect category from the NCR form without requiring new columns", () => {
    const signals = signalsFromNcr({
      id: 7,
      createdAt: NOW,
      supplierId: 4,
      title: "Bore scratch",
      description: null,
      form: {
        partNumberDescription: "PN-100 / housing",
        nonconformanceCategory: [{ category: { Dimensional: true, Visual: false } }],
        nonconformanceDescription: "scratch on the bore",
      },
      partNumbers: [],
    });
    expect(signals.part).toBe("pn-100");
    expect(signals.defectCode).toBe("Dimensional");
    expect(normalizePart("  ")).toBeNull();
  });
});

describe("8D due and closure", () => {
  it("treats a written D8 closure as closed and reads a dated target from the step data", () => {
    expect(eightDIsClosed({ d8_closure: "  " })).toBe(false);
    expect(eightDIsClosed({ d8_closure: "Verified on the floor" })).toBe(true);
    expect(eightDDueDate({ d4_target_date: "2026-10-01" })?.toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(eightDDueDate({ notes: "due sometime" })).toBeNull();
  });
});

describe("notice email", () => {
  it("links each record to the public app and escapes the label", () => {
    const rendered = renderNoticeEmail({
      heading: "Overdue",
      intro: "These records are past their due date.",
      items: [{ label: "NCR #4 <draft>", detail: "Due 2026-09-20", href: "https://app.accuqualqms.com/ncr/4" }],
    });
    expect(rendered.text).toContain("https://app.accuqualqms.com/ncr/4");
    expect(rendered.html).toContain('href="https://app.accuqualqms.com/ncr/4"');
    expect(rendered.html).toContain("NCR #4 &lt;draft&gt;");
    expect(rendered.html).not.toContain("NCR #4 <draft>");
    expect(recordHref("https://app.accuqualqms.com", "/capa/8")).toBe("https://app.accuqualqms.com/capa/8");
    expect(noticeCopy("digest", 2).subject).toBe("Your AccuQual day: 2 items");
  });
});

describe("daily digest preference", () => {
  it("stays on unless the user turns it off, and stays independent of the in-app switch", () => {
    expect(normalizeNotificationPreferences(null).dailyDigest).toBe(true);
    expect(normalizeNotificationPreferences({ dailyDigest: false }).dailyDigest).toBe(false);
    expect(normalizeNotificationPreferences({ email: false, dailyDigest: true }).email).toBe(false);
  });
});
