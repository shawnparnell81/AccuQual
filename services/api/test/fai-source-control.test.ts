import { describe, expect, it } from "vitest";
import { faiResult } from "../src/utils/passFail.js";
import {
  addCalendarMonths,
  approveSource,
  canApproveFai,
  freezeCharacteristic,
  judgeFrozen,
  needsAnnualPull,
  newSourceRow,
  noticeApproved,
  noticeAssigned,
  noticeDueSoon,
  noticeOverdue,
  noticePullAssigned,
  noticePullRecorded,
  noticeRejected,
  noticeSubmitted,
  rejectSource,
  revisionForPlanSave,
  sourceQueueBucket,
  structureKey,
  type CharacteristicInput,
  type PlanStructure,
} from "../src/modules/fai/fai.logic.js";

const percentRule: CharacteristicInput = { name: "Outside diameter", mode: "percent_nominal", nominal: "100", percent: "10" };

describe("first article limit freeze", () => {
  it("keeps the copied limits after the plan rule changes", () => {
    const rule: CharacteristicInput = { ...percentRule };
    const frozen = freezeCharacteristic(rule);
    rule.percent = "1";
    expect(frozen.limitLow).toBe("90");
    expect(frozen.limitHigh).toBe("110");
    expect(frozen.mode).toBe("percent_nominal");
    expect(frozen.nominal).toBe("100");
    expect(judgeFrozen(frozen, "91")).toBe("Pass");
    expect(judgeFrozen(freezeCharacteristic(rule), "91")).toBe("Fail");
  });

  it("does not revise the plan when characteristics are copied for an FAI", () => {
    const plan: PlanStructure = {
      scope: "part",
      partNumber: "4400-12",
      productFamily: null,
      supplierId: null,
      cadenceMonths: 6,
      characteristics: [percentRule],
    };
    const before = structureKey(plan);
    const revision = revisionForPlanSave(3, plan, plan);
    plan.characteristics.map((row) => freezeCharacteristic(row));
    expect(structureKey(plan)).toBe(before);
    expect(revision).toBe(3);
    expect(revisionForPlanSave(3, plan, { ...plan, characteristics: [{ ...percentRule, percent: "5" }] })).toBe(4);
  });

  it("leaves the existing nominal and tolerance check in place", () => {
    expect(faiResult(100, 1, 102)).toBe("Fail");
    const frozen = freezeCharacteristic({ name: "Length", mode: "percent_nominal", nominal: "100", percent: "5" });
    expect(judgeFrozen(frozen, "102")).toBe("Pass");
    expect(judgeFrozen(frozen, "106")).toBe("Fail");
  });
});

describe("pass/fail for the four limit modes", () => {
  it("judges percent from nominal", () => {
    const line = freezeCharacteristic({ name: "OD", mode: "percent_nominal", nominal: "200", percent: "1" });
    expect(line.limitLow).toBe("198");
    expect(line.limitHigh).toBe("202");
    expect(judgeFrozen(line, "198")).toBe("Pass");
    expect(judgeFrozen(line, "197.9")).toBe("Fail");
    expect(judgeFrozen(line, "")).toBe("");
  });

  it("judges plus and minus", () => {
    const line = freezeCharacteristic({ name: "Width", mode: "plus_minus", nominal: "10", plusTolerance: "0.2", minusTolerance: "0.1" });
    expect(line.limitLow).toBe("9.9");
    expect(line.limitHigh).toBe("10.2");
    expect(judgeFrozen(line, "9.9")).toBe("Pass");
    expect(judgeFrozen(line, "9.89")).toBe("Fail");
    expect(judgeFrozen(line, "10.2")).toBe("Pass");
    expect(judgeFrozen(line, "10.21")).toBe("Fail");
    const bilateral = freezeCharacteristic({ name: "Width", mode: "plus_minus", nominal: "10", plusTolerance: "0.05" });
    expect(bilateral.limitLow).toBe("9.95");
    expect(bilateral.limitHigh).toBe("10.05");
  });

  it("judges direct minimum and maximum", () => {
    const line = freezeCharacteristic({ name: "Hardness", mode: "min_max", specMin: "5", specMax: "8" });
    expect(judgeFrozen(line, "5")).toBe("Pass");
    expect(judgeFrozen(line, "8")).toBe("Pass");
    expect(judgeFrozen(line, "4.9")).toBe("Fail");
    expect(judgeFrozen(line, "8.1")).toBe("Fail");
    const maxOnly = freezeCharacteristic({ name: "Runout", mode: "min_max", specMax: "0.2" });
    expect(judgeFrozen(maxOnly, "0.2")).toBe("Pass");
    expect(judgeFrozen(maxOnly, "0.21")).toBe("Fail");
    expect(judgeFrozen(maxOnly, "0")).toBe("Pass");
  });

  it("judges an attribute as the recorded pass or fail", () => {
    const line = freezeCharacteristic({ name: "Threads clean", mode: "attribute" });
    expect(line.limitLow).toBeNull();
    expect(line.limitHigh).toBeNull();
    expect(judgeFrozen(line, null, "Pass")).toBe("Pass");
    expect(judgeFrozen(line, null, "Fail")).toBe("Fail");
    expect(judgeFrozen(line, null, null)).toBe("");
  });
});

describe("source approval dates", () => {
  it("adds calendar months and clamps the month end", () => {
    expect(addCalendarMonths("2026-01-15", 6)).toBe("2026-07-15");
    expect(addCalendarMonths("2026-01-31", 12)).toBe("2027-01-31");
    expect(addCalendarMonths("2026-08-31", 6)).toBe("2027-02-28");
    expect(addCalendarMonths("2024-08-31", 6)).toBe("2025-02-28");
    expect(addCalendarMonths("2023-08-31", 6)).toBe("2024-02-29");
    expect(addCalendarMonths("2026-03-31", 1)).toBe("2026-04-30");
  });

  it("starts a new supplier pending and updates the row on approval or rejection", () => {
    const pending = newSourceRow(6);
    expect(pending).toEqual({ status: "pending", lastPassDate: null, nextDueDate: null, cadenceMonths: 6 });

    const approved = approveSource(pending, "2026-01-15", 6);
    expect(approved.status).toBe("approved");
    expect(approved.lastPassDate).toBe("2026-01-15");
    expect(approved.nextDueDate).toBe("2026-07-15");

    const yearly = approveSource(pending, "2026-01-31", 12);
    expect(yearly.nextDueDate).toBe("2027-01-31");
    expect(yearly.cadenceMonths).toBe(12);

    const defaulted = approveSource(pending, "2026-03-01", 0);
    expect(defaulted.nextDueDate).toBe("2026-09-01");
    expect(defaulted.cadenceMonths).toBe(6);

    const failed = rejectSource(approved);
    expect(failed.status).toBe("failed");
    expect(failed.lastPassDate).toBe("2026-01-15");
    expect(failed.nextDueDate).toBe("2026-07-15");

    const passedAgain = approveSource(failed, "2026-08-01", 6);
    expect(passedAgain.status).toBe("approved");
    expect(passedAgain.lastPassDate).toBe("2026-08-01");
    expect(passedAgain.nextDueDate).toBe("2027-02-01");
  });

  it("places due, overdue, and failed sources on the queue", () => {
    expect(sourceQueueBucket({ status: "approved", nextDueDate: "2026-04-02" }, "2026-03-03")).toBe("due_soon");
    expect(sourceQueueBucket({ status: "approved", nextDueDate: "2026-05-04" }, "2026-03-03")).toBeNull();
    expect(sourceQueueBucket({ status: "approved", nextDueDate: "2026-03-02" }, "2026-03-03")).toBe("overdue");
    expect(sourceQueueBucket({ status: "failed", nextDueDate: "2026-03-02" }, "2026-03-03")).toBe("failed");
    expect(sourceQueueBucket({ status: "pending", nextDueDate: null }, "2026-03-03")).toBeNull();
    expect(needsAnnualPull(null, "2026-10-03")).toBe(true);
    expect(needsAnnualPull("2025-10-04", "2026-10-03")).toBe(false);
    expect(needsAnnualPull("2025-10-03", "2026-10-03")).toBe(true);
  });

  it("lets Quality approve and keeps Engineering on result entry", () => {
    expect(canApproveFai({ roleName: "operator", department: "quality" })).toBe(true);
    expect(canApproveFai({ roleName: "operator", department: "engineering" })).toBe(false);
    expect(canApproveFai({ roleName: "quality_manager", department: "engineering" })).toBe(true);
    expect(canApproveFai({ roleName: "admin", department: null })).toBe(true);
  });
});

describe("first article notices", () => {
  const notices = [
    noticeAssigned("FAI-2026-000184", "Priya Shah"),
    noticeSubmitted("FAI-2026-000184"),
    noticeApproved("FAI-2026-000184", "4400-12", "Northline Metals", "April 3, 2027"),
    noticeRejected("FAI-2026-000184", "4400-12", "Northline Metals"),
    noticeDueSoon("4400-12", "Northline Metals", "April 3, 2027"),
    noticeOverdue("4400-12", "Northline Metals"),
    noticePullAssigned("Priya Shah", "4400-12"),
    noticePullRecorded("4400-12"),
  ];

  it("uses the agreed wording", () => {
    expect(notices[0]).toBe("FAI-2026-000184 is ready for result entry. It is assigned to Priya Shah.");
    expect(notices[1]).toBe("FAI-2026-000184 has been submitted for Quality review.");
    expect(notices[2]).toBe("FAI-2026-000184 was approved. 4400-12 from Northline Metals is approved. The next inspection is due April 3, 2027.");
    expect(notices[3]).toBe("FAI-2026-000184 was not approved. A nonconformance was opened. 4400-12 from Northline Metals is not approved.");
    expect(notices[4]).toBe("Inspection for 4400-12 from Northline Metals is due on April 3, 2027.");
    expect(notices[5]).toBe("Inspection for 4400-12 from Northline Metals is overdue.");
    expect(notices[6]).toBe("Priya Shah has been assigned the annual pull for 4400-12.");
    expect(notices[7]).toBe("The annual pull for 4400-12 has been recorded.");
    for (const text of notices) expect(text.toLowerCase()).not.toContain("your turn");
  });
});
