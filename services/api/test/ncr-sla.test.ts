import { describe, expect, it } from "vitest";
import { addBusinessDays, evaluateSla, ncrProcessMetrics, priorityForSeverity, severityClass, stageDue } from "../src/modules/ncr/ncrSla.js";

const opened = new Date("2026-01-05T12:00:00.000Z");

describe("NCR SLA rules", () => {
  it("maps severity to priority", () => {
    expect(priorityForSeverity(severityClass("critical"))).toBe("Critical");
    expect(priorityForSeverity(severityClass("high"))).toBe("High");
    expect(priorityForSeverity(severityClass("Minor"))).toBe("Normal");
  });

  it("counts Monday through Friday as business days", () => {
    const friday = new Date("2026-01-02T15:00:00.000Z");
    expect(addBusinessDays(friday, 1).toISOString().slice(0, 10)).toBe("2026-01-05");
    expect(addBusinessDays(opened, 5).toISOString().slice(0, 10)).toBe("2026-01-12");
  });

  it("sets quality review due one day after submit and warns at 12 hours", () => {
    const due = stageDue({ stage: "Quality Review", severity: "Minor", priority: "Normal", openedAt: opened, stageEnteredAt: opened, lastCorrectiveActionAt: null, implementationRisk: null, now: opened });
    expect(due.due?.toISOString()).toBe("2026-01-06T12:00:00.000Z");
    const warning = evaluateSla({
      now: new Date("2026-01-06T00:00:00.000Z"),
      ncrNumber: "NCR-1",
      severity: "Minor",
      workflowStage: "Quality Review",
      openedAt: opened,
      stageEnteredAt: opened,
      lastCorrectiveActionAt: null,
      implementationRisk: null,
      closed: false,
      noticesSent: [],
      correctiveActionDueAt: null,
      correctiveActionComplete: false,
      ncrType: "Internal",
    });
    expect(warning.slaStatus).toBe("Approaching Due Date");
    expect(warning.notices.some((notice) => notice.key === "stage:quality-review:12h" && notice.targets.includes("Quality Manager"))).toBe(true);
  });

  it("escalates quality review after more than 3 overdue days", () => {
    const result = evaluateSla({
      now: new Date("2026-01-10T12:00:00.000Z"),
      ncrNumber: "NCR-1",
      severity: "Minor",
      workflowStage: "Quality Review",
      openedAt: opened,
      stageEnteredAt: opened,
      lastCorrectiveActionAt: null,
      implementationRisk: null,
      closed: false,
      noticesSent: [],
      correctiveActionDueAt: null,
      correctiveActionComplete: false,
      ncrType: "Internal",
    });
    expect(result.slaStatus).toBe("Escalated");
    expect(result.notices.some((notice) => notice.key === "stage-escalated:Quality Review" && notice.targets.includes("Executive Management"))).toBe(true);
  });

  it("gives critical containment 4 hours and major 24, and minor none", () => {
    expect(stageDue({ stage: "Containment", severity: "Critical", priority: "Critical", openedAt: opened, stageEnteredAt: opened, lastCorrectiveActionAt: null, implementationRisk: null, now: opened }).due?.toISOString()).toBe("2026-01-05T16:00:00.000Z");
    expect(stageDue({ stage: "Containment", severity: "Major", priority: "High", openedAt: opened, stageEnteredAt: opened, lastCorrectiveActionAt: null, implementationRisk: null, now: opened }).due?.toISOString()).toBe("2026-01-06T12:00:00.000Z");
    expect(stageDue({ stage: "Containment", severity: "Minor", priority: "Normal", openedAt: opened, stageEnteredAt: opened, lastCorrectiveActionAt: null, implementationRisk: null, now: opened }).due).toBeNull();
  });

  it("notifies the RCA owner at 80 percent of a 2-business-day critical root cause", () => {
    const started = new Date("2026-01-05T00:00:00.000Z");
    const result = evaluateSla({
      now: new Date("2026-01-06T16:00:00.000Z"),
      ncrNumber: "NCR-9",
      severity: "Critical",
      workflowStage: "Root Cause Analysis",
      openedAt: started,
      stageEnteredAt: started,
      lastCorrectiveActionAt: null,
      implementationRisk: null,
      closed: false,
      noticesSent: [],
      correctiveActionDueAt: null,
      correctiveActionComplete: false,
      ncrType: "Internal",
    });
    expect(result.notices.some((notice) => notice.key === "stage:rca:80" && notice.targets.includes("RCA owner"))).toBe(true);
  });

  it("warns at 75 and 90 percent of the overall close target and escalates past it", () => {
    const early = evaluateSla({
      now: new Date("2026-01-28T12:00:00.000Z"),
      ncrNumber: "NCR-2",
      severity: "Minor",
      workflowStage: "Corrective Action",
      openedAt: opened,
      stageEnteredAt: new Date("2026-02-01T12:00:00.000Z"),
      lastCorrectiveActionAt: null,
      implementationRisk: null,
      closed: false,
      noticesSent: [],
      correctiveActionDueAt: null,
      correctiveActionComplete: true,
      ncrType: "Internal",
    });
    expect(early.notices.some((notice) => notice.key === "overall:75" || notice.key === "overall:90")).toBe(true);
    const late = evaluateSla({
      now: new Date("2026-03-20T12:00:00.000Z"),
      ncrNumber: "NCR-2",
      severity: "Minor",
      workflowStage: "Corrective Action",
      openedAt: opened,
      stageEnteredAt: new Date("2026-03-01T12:00:00.000Z"),
      lastCorrectiveActionAt: null,
      implementationRisk: null,
      closed: false,
      noticesSent: [],
      correctiveActionDueAt: null,
      correctiveActionComplete: true,
      ncrType: "Internal",
    });
    expect(late.slaStatus).toBe("Escalated");
    expect(late.notices.some((notice) => notice.key === "overall:exceeded" && notice.targets.includes("Executive Sponsor"))).toBe(true);
  });

  it("reminds 7, 3, and 1 days before, on the due date, and on the overdue schedule", () => {
    const stageEntered = new Date("2026-01-05T12:00:00.000Z");
    const keysFor = (now: string) =>
      evaluateSla({
        now: new Date(now),
        ncrNumber: "NCR-3",
        severity: "Minor",
        workflowStage: "Management Approval",
        openedAt: opened,
        stageEnteredAt: stageEntered,
        lastCorrectiveActionAt: null,
        implementationRisk: null,
        closed: false,
        noticesSent: [],
        correctiveActionDueAt: null,
        correctiveActionComplete: true,
        ncrType: "Internal",
      }).notices.map((notice) => notice.key);
    // 3 business days from Monday Jan 5 is Thursday Jan 8.
    expect(keysFor("2026-01-01T12:00:00.000Z")).toContain("reminder:Management Approval:before:7");
    expect(keysFor("2026-01-05T12:00:00.000Z")).toContain("reminder:Management Approval:before:3");
    expect(keysFor("2026-01-07T12:00:00.000Z")).toContain("reminder:Management Approval:before:1");
    expect(keysFor("2026-01-08T12:00:00.000Z")).toContain("reminder:Management Approval:due:0");
    expect(keysFor("2026-01-09T12:00:00.000Z")).toContain("reminder:Management Approval:overdue:1");
    expect(keysFor("2026-01-22T12:00:00.000Z")).toContain("reminder:Management Approval:overdue:14");
    expect(keysFor("2026-01-29T12:00:00.000Z")).toContain("reminder:Management Approval:overdue:21");
  });

  it("uses implementation windows of 30, 21, 14, and 7 days", () => {
    const start = opened;
    const dueFor = (priority: string, risk?: string) => stageDue({ stage: "Implementation", severity: "Major", priority, openedAt: start, stageEnteredAt: start, lastCorrectiveActionAt: null, implementationRisk: risk ?? null, now: start }).due;
    expect(dueFor("Normal")!.getTime() - start.getTime()).toBe(21 * 86_400_000);
    expect(dueFor("High")!.getTime() - start.getTime()).toBe(14 * 86_400_000);
    expect(dueFor("Critical")!.getTime() - start.getTime()).toBe(7 * 86_400_000);
    expect(dueFor("Normal", "Low")!.getTime() - start.getTime()).toBe(30 * 86_400_000);
  });

  it("rolls dashboard counts up from NCR rows", () => {
    const metrics = ncrProcessMetrics([
      { id: 1, status: "ncr_created", severity: "critical", title: "Crack", description: null, supplierId: null, createdAt: opened, closedAt: null, workflowStage: "Quality Review", slaStatus: "Overdue", daysOpen: 4, daysInStage: 1, processData: { ncr_type: "Customer", department: "Quality", severity: "Critical" } },
      { id: 2, status: "closed", severity: "low", title: "Scratch", description: null, supplierId: 5, createdAt: opened, closedAt: new Date("2026-01-20T00:00:00.000Z"), workflowStage: "Closed", slaStatus: "On Track", daysOpen: 15, daysInStage: 0, processData: { ncr_type: "Supplier", department: "Quality", part_number: "P-1", stageHistory: [{ stage: "Root Cause Analysis", at: "2026-01-06T00:00:00.000Z" }, { stage: "Corrective Action", at: "2026-01-08T00:00:00.000Z" }, { stage: "Implementation", at: "2026-01-11T00:00:00.000Z" }, { stage: "Effectiveness Verification", at: "2026-01-18T00:00:00.000Z" }, { stage: "Closed", at: "2026-01-20T00:00:00.000Z" }] } },
      { id: 3, status: "contain", severity: "low", title: "Scratch", description: null, supplierId: 5, createdAt: opened, closedAt: null, workflowStage: null, slaStatus: null, daysOpen: 2, daysInStage: null, processData: { part_number: "P-1", department: "Production" } },
    ]);
    expect(metrics.openCount).toBe(2);
    expect(metrics.overdueCount).toBe(1);
    expect(metrics.criticalCount).toBe(1);
    expect(metrics.customerCount).toBe(1);
    expect(metrics.supplierCount).toBe(1);
    expect(metrics.repeatCount).toBe(2);
    expect(metrics.averageRcaDays).toBe(2);
    expect(metrics.averageCorrectiveActionDays).toBe(3);
    expect(metrics.averageVerificationDays).toBe(2);
    expect(metrics.slaCompliancePercent).toBe(100);
    expect(metrics.byDepartment.map((item) => item.label).sort()).toEqual(["Production", "Quality"]);
    expect(metrics.closureTrend).toEqual([{ label: "2026-01", count: 1 }]);
  });
});
