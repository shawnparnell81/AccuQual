import { describe, expect, it } from "vitest";
import { updateCrarSchema } from "../src/modules/crar/crar.validation.js";

describe("CRAR save", () => {
  it("accepts a cleared date box with the customer name and RMA number", () => {
    const parsed = updateCrarSchema.parse({ customerName: "Acme", rmaNumber: "RMA-1", reportDate: "", dateReceived: "2026-10-14" });
    expect(parsed.reportDate).toBeNull();
    expect(parsed.customerName).toBe("Acme");
    expect(parsed.dateReceived).toBeInstanceOf(Date);
  });
});
