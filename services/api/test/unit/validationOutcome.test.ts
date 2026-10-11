import { describe, expect, it } from "vitest";
import { validationOutcome } from "../../src/modules/executive/executive.data.js";

describe("validationOutcome", () => {
  it("reads CSA fail from D51", () => {
    expect(validationOutcome({ formType: "csa", cells: { D51: true } })).toBe("fail");
  });

  it("reads CSA pass from B51 or F51", () => {
    expect(validationOutcome({ formType: "csa", cells: { B51: true } })).toBe("pass");
    expect(validationOutcome({ formType: "csa", cells: { F51: true } })).toBe("pass");
  });

  it("reads fuel pump fail from E52 and pass from C52/H52", () => {
    expect(validationOutcome({ formType: "fuel_pump", cells: { E52: true } })).toBe("fail");
    expect(validationOutcome({ formType: "fuel_pump", cells: { C52: true } })).toBe("pass");
    expect(validationOutcome({ formType: "fuel_pump", cells: { H52: true } })).toBe("pass");
  });

  it("lets fuel pump row 59 override row 52 when ticked", () => {
    // Row 52 says pass, but Further Review row 59 says fail.
    expect(
      validationOutcome({ formType: "fuel_pump", cells: { C52: true, E59: true } })
    ).toBe("fail");
    // Row 52 says fail, but Further Review row 59 says pass.
    expect(
      validationOutcome({ formType: "fuel_pump", cells: { E52: true, H59: true } })
    ).toBe("pass");
  });

  it("returns open when no disposition is ticked", () => {
    expect(validationOutcome({ formType: "csa", cells: {} })).toBe("open");
    expect(validationOutcome({ formType: "fuel_pump", cells: {} })).toBe("open");
  });

  it("falls back to text search for unknown form types", () => {
    expect(validationOutcome({ formType: "unknown", cells: {} })).toBe("open");
  });
});
