import { describe, expect, it } from "vitest";
import { productTypeFor } from "../../src/modules/fai-inspection/fai-product-type.js";

describe("productTypeFor", () => {
  it("recognizes CSA text", () => {
    expect(productTypeFor("CSA")).toBe("csa");
    expect(productTypeFor("Complete Strut Assembly")).toBe("csa");
    expect(productTypeFor("Struts - CSA")).toBe("csa");
  });

  it("recognizes Fuel Pump text", () => {
    expect(productTypeFor("Fuel Pump")).toBe("fuel_pump");
    expect(productTypeFor("fuel pumps")).toBe("fuel_pump");
  });

  it("is null for anything else, including empty/missing text", () => {
    expect(productTypeFor("Brake pads")).toBeNull();
    expect(productTypeFor("")).toBeNull();
    expect(productTypeFor(null)).toBeNull();
    expect(productTypeFor(undefined)).toBeNull();
  });
});
