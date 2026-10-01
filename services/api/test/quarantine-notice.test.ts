import { describe, expect, it } from "vitest";
import { noticeHoldFromCells } from "../src/modules/quarantine/quarantineNotice.js";
import { gageUsageBlockReason, inspectionGageIds } from "../src/modules/calibration/gageUsage.js";

describe("FRM-NCR-002 hold from the notice sheet", () => {
  it("builds one hold from the part number and the location quantities", () => {
    const hold = noticeHoldFromCells({
      B6: "PN-441",
      B7: "LOT-9",
      B11: "Crack along the flange",
      A17: "Cage A",
      B17: 4,
      A18: "Cage B",
      B18: "1",
      B19: 0,
    });
    expect(hold).toMatchObject({
      partNumber: "PN-441",
      quantity: 5,
      lotNumber: "LOT-9",
      reason: "Crack along the flange",
      locations: [
        { location: "Cage A", quantity: 4 },
        { location: "Cage B", quantity: 1 },
      ],
    });
  });

  it("does not invent a hold for a blank notice", () => {
    expect(noticeHoldFromCells({})).toBeNull();
    expect(noticeHoldFromCells({ B6: "PN-1" })).toBeNull();
    expect(noticeHoldFromCells({ B17: 2 })).toBeNull();
  });
});

describe("gage usage block", () => {
  it("blocks overdue, failed, inactive, and out-of-service gages, and leaves a current gage usable", () => {
    expect(gageUsageBlockReason("inactive", "current")).toMatch(/inactive/);
    expect(gageUsageBlockReason("out_of_service", "failed")).toMatch(/out of service/);
    expect(gageUsageBlockReason("active", "failed")).toMatch(/failed calibration/);
    expect(gageUsageBlockReason("active", "overdue")).toMatch(/overdue/);
    expect(gageUsageBlockReason("active", "due_soon")).toBeNull();
    expect(gageUsageBlockReason("active", "current")).toBeNull();
  });

  it("reads gage ids from inspection characteristic rows", () => {
    expect(inspectionGageIds({ keyCharacteristicResults: [{ gageId: " CAL-9 " }, { gageId: "" }, { gageId: "CAL-9" }, {}] })).toEqual(["CAL-9"]);
    expect(inspectionGageIds({})).toEqual([]);
  });
});
