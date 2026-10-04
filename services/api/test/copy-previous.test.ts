import { describe, expect, it } from "vitest";
import { cleanLimitOverrides, copyCharacteristicLine, copyValidationCells, validationPartNumber } from "../src/modules/records/copyPrevious.js";

describe("copy from previous", () => {
  it("keeps characteristic setup and blanks the result", () => {
    const line = copyCharacteristicLine({
      sortOrder: 4,
      balloon: "25",
      name: "Length",
      mode: "plus_minus",
      nominal: "10",
      percent: null,
      plusTolerance: "0.1",
      minusTolerance: "0.1",
      specMin: null,
      specMax: null,
      limitLow: "9.9",
      limitHigh: "10.1",
      actual: "10.4",
      attributeResult: "Fail",
      result: "Fail",
    });
    expect(line.limitLow).toBe("9.9");
    expect(line.nominal).toBe("10");
    expect(line.actual).toBeNull();
    expect(line.attributeResult).toBeNull();
    expect(line.result).toBe("");
  });

  it("copies CSA setup cells and drops samples, pass/fail, and signatures", () => {
    const cells = copyValidationCells("csa", {
      B6: "STRUT-1",
      F6: "DWG-9",
      B7: "Complete strut",
      B12: "Length",
      C12: "10",
      D12: "10.4",
      E12: "Fail",
      B8: "Inspector",
      authorizedSignature: "Shawn 2026-10-01",
    });
    expect(cells.B6).toBe("STRUT-1");
    expect(cells.B12).toBe("Length");
    expect(cells.C12).toBe("10");
    expect(cells.D12).toBeUndefined();
    expect(cells.E12).toBeUndefined();
    expect(cells.B8).toBeUndefined();
    expect(cells.authorizedSignature).toBeUndefined();
    expect(validationPartNumber({ B6: " STRUT-1 " })).toBe("STRUT-1");
  });

  it("keeps fuel pump nominal and tolerance cells and drops the sample", () => {
    const cells = copyValidationCells("fuel_pump", {
      B6: "PUMP-1",
      B13: "10",
      D13: "0.2",
      G13: "10.4",
      H13: "Fail",
      B29: "Pressure note",
      B53: "signed",
    });
    expect(cells.B13).toBe("10");
    expect(cells.D13).toBe("0.2");
    expect(cells.B29).toBe("Pressure note");
    expect(cells.G13).toBeUndefined();
    expect(cells.H13).toBeUndefined();
    expect(cells.B53).toBeUndefined();
  });

  it("copies only limit text", () => {
    expect(cleanLimitOverrides({ length: { specifiedLimits: " 9-11 ", units: "mm" }, empty: { specifiedLimits: "  " } })).toEqual({
      length: { specifiedLimits: "9-11", units: "mm" },
    });
  });
});
