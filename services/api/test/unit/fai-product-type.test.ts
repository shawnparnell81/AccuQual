import { describe, expect, it } from "vitest";
import { productTypeFor } from "../../src/modules/fai-inspection/fai-product-type.js";

describe("productTypeFor", () => {
  it("recognizes CSA text", () => {
    expect(productTypeFor("CSA")).toBe("csa");
    expect(productTypeFor("Complete Strut Assembly")).toBe("csa");
    expect(productTypeFor("Struts - CSA")).toBe("csa");
    expect(productTypeFor("strut assembly")).toBe("csa");
  });

  it("recognizes Fuel Pump text", () => {
    expect(productTypeFor("Fuel Pump")).toBe("fuel_pump");
    expect(productTypeFor("fuel pumps")).toBe("fuel_pump");
  });

  it("recognizes every other family", () => {
    expect(productTypeFor("Air Strut")).toBe("air_strut");
    expect(productTypeFor("Air Suspension")).toBe("air_strut");
    expect(productTypeFor("air strut assembly")).toBe("air_strut");
    expect(productTypeFor("Air Spring")).toBe("air_spring");
    expect(productTypeFor("air bag")).toBe("air_spring");
    expect(productTypeFor("Fuel Injector")).toBe("fuel_injector");
    expect(productTypeFor("Brake Wear Sensor")).toBe("brake_wear");
    expect(productTypeFor("Electric Lift Support")).toBe("electric_lift");
    expect(productTypeFor("Power Lift")).toBe("electric_lift");
    expect(productTypeFor("Gas Lift Support")).toBe("regular_gas_lift");
    expect(productTypeFor("gas spring")).toBe("regular_gas_lift");
    expect(productTypeFor("gas strut")).toBe("regular_gas_lift");
    expect(productTypeFor("Coil Spring")).toBe("coil_spring");
    expect(productTypeFor("Shock")).toBe("shock");
    expect(productTypeFor("shock absorber")).toBe("shock");
  });

  it("does not collide", () => {
    expect(productTypeFor("gas lift support")).toBe("regular_gas_lift");
    expect(productTypeFor("electric lift support")).toBe("electric_lift");
    expect(productTypeFor("gas lift support")).not.toBe("electric_lift");
    expect(productTypeFor("electric lift support")).not.toBe("regular_gas_lift");
    expect(productTypeFor("gas lift support")).not.toBe("fuel_pump");
    expect(productTypeFor("electric lift support")).not.toBe("fuel_pump");
    expect(productTypeFor("fuel pump")).not.toBe("fuel_injector");
    expect(productTypeFor("fuel injector")).not.toBe("fuel_pump");
    expect(productTypeFor("strut assembly")).toBe("csa");
    expect(productTypeFor("coil spring")).toBe("coil_spring");
    expect(productTypeFor("coil spring")).not.toBe("air_spring");
    expect(productTypeFor("air spring")).not.toBe("coil_spring");
    expect(productTypeFor("air compressor")).toBeNull();
  });

  it("'shocks absorber mount' matches shock: the spec's \bshocks?\b pattern matches the word 'shocks'", () => {
    expect(productTypeFor("shocks absorber mount")).toBe("shock");
    expect(productTypeFor("shockwave")).toBeNull();
  });

  it("is null for anything else, including empty/missing text", () => {
    expect(productTypeFor("Brake pads")).toBeNull();
    expect(productTypeFor("")).toBeNull();
    expect(productTypeFor(null)).toBeNull();
    expect(productTypeFor(undefined)).toBeNull();
  });
});
