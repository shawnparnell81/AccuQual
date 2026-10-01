import { describe, expect, it } from "vitest";
import { supplierOrderBlockMessage } from "../src/modules/erp/supplierOrder.js";

describe("supplier order gate", () => {
  it("blocks only disqualified and suspended suppliers, and names the status", () => {
    expect(supplierOrderBlockMessage("disqualified")).toMatch(/disqualified/);
    expect(supplierOrderBlockMessage("suspended")).toMatch(/suspended/);
    expect(supplierOrderBlockMessage(" Suspended ")).toMatch(/suspended/);
  });

  it("lets active and probation suppliers through", () => {
    expect(supplierOrderBlockMessage("active")).toBeNull();
    expect(supplierOrderBlockMessage("probation")).toBeNull();
    expect(supplierOrderBlockMessage("approved")).toBeNull();
    expect(supplierOrderBlockMessage(null)).toBeNull();
  });
});
