import { describe, expect, it } from "vitest";
import { isPlaceholderEquipment } from "../../src/modules/controlled-lists/service.js";

describe("Master Equipment List placeholder rows", () => {
  it("skips equipment named after a blank calibration form with nothing else filled in", () => {
    expect(isPlaceholderEquipment({ name: "Calibration Record", serialNumber: null, metadata: {} }, false)).toBe(true);
    expect(isPlaceholderEquipment({ name: " ", serialNumber: "", metadata: null }, false)).toBe(true);
  });

  it("keeps real gages", () => {
    expect(isPlaceholderEquipment({ name: "Caliper 6in", serialNumber: null, metadata: {} }, false)).toBe(false);
    expect(isPlaceholderEquipment({ name: "Calibration Record", serialNumber: "SN-1", metadata: {} }, false)).toBe(false);
    expect(isPlaceholderEquipment({ name: "Calibration Record", serialNumber: null, metadata: { assetId: "G-12" } }, false)).toBe(false);
    expect(isPlaceholderEquipment({ name: "Calibration Record", serialNumber: null, metadata: {} }, true)).toBe(false);
  });
});
