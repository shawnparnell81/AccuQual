import { describe, expect, it } from "vitest";
import { addDays, addMonths, dueStatusFor } from "../../src/modules/fai-inspection/fai-due-status.js";

const TODAY = "2026-06-15";

describe("dueStatusFor", () => {
  it("is null with no due date", () => {
    expect(dueStatusFor(null, TODAY)).toBeNull();
    expect(dueStatusFor(undefined, TODAY)).toBeNull();
  });

  it("is null when the due date is more than 30 days out", () => {
    expect(dueStatusFor("2026-07-20", TODAY)).toBeNull(); // 35 days
  });

  it("is due_soon at exactly 30 days out", () => {
    expect(dueStatusFor(addDays(TODAY, 30), TODAY)).toBe("due_soon");
  });

  it("is due_soon for today itself (0 days out)", () => {
    expect(dueStatusFor(TODAY, TODAY)).toBe("due_soon");
  });

  it("is overdue for yesterday", () => {
    expect(dueStatusFor(addDays(TODAY, -1), TODAY)).toBe("overdue");
  });

  it("is overdue for a date far in the past", () => {
    expect(dueStatusFor("2020-01-01", TODAY)).toBe("overdue");
  });
});

describe("addMonths", () => {
  it("adds whole months", () => {
    expect(addMonths("2026-01-15", 6)).toBe("2026-07-15");
  });
  it("subtracts months (negative)", () => {
    expect(addMonths("2026-07-15", -6)).toBe("2026-01-15");
  });
  it("rolls over a year boundary", () => {
    expect(addMonths("2026-11-01", 3)).toBe("2027-02-01");
  });
});
