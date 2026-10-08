import { describe, expect, it } from "vitest";
import { cleanRecordNumber, numberEdit, recordNumberKey, showRecordNumber } from "./userRecordNumber.js";

describe("user record numbers", () => {
  it("treats a blank value as no number and never substitutes an id", () => {
    expect(cleanRecordNumber("   ")).toBeNull();
    expect(cleanRecordNumber(undefined)).toBeNull();
    expect(cleanRecordNumber(12)).toBeNull();
    expect(showRecordNumber(null)).toBe("");
    expect(showRecordNumber("  NCR-14  ")).toBe("NCR-14");
    expect(showRecordNumber("")).not.toBe("12");
  });

  it("folds case and spaces so the same number cannot be saved twice in one type", () => {
    expect(recordNumberKey("NCR 1")).toBe(recordNumberKey("ncr1"));
    expect(recordNumberKey("CAPA-0001")).toBe(recordNumberKey("capa - 0001"));
    expect(recordNumberKey("NCR 1")).not.toBe(recordNumberKey("SCAR 1"));
  });

  it("records the old and new number for the audit trail", () => {
    expect(numberEdit("NCR No.", "NCR-1", "NCR 2")).toEqual({ label: "NCR No.", from: "NCR-1", to: "NCR 2" });
    expect(numberEdit("NCR No.", "", "  ")).toBeNull();
    expect(numberEdit("Record No.", null, "QA-9")).toEqual({ label: "Record No.", from: "", to: "QA-9" });
  });
});
