import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hideReceivingInventoryTarget, isReceivingInventoryPath, receivingInventoryEnabled } from "./receivingInventoryFlag.ts";

describe("receiving & inventory company flag", () => {
  it("stays off until an admin turns it on", () => {
    assert.equal(receivingInventoryEnabled(undefined), false);
    assert.equal(receivingInventoryEnabled(null), false);
    assert.equal(receivingInventoryEnabled(false), false);
    assert.equal(receivingInventoryEnabled(true), true);
  });

  it("recognizes inventory, purchase order/receiving and the admin settings routes", () => {
    assert.equal(isReceivingInventoryPath("/inventory"), true);
    assert.equal(isReceivingInventoryPath("/inventory/lots/4"), true);
    assert.equal(isReceivingInventoryPath("/erp/12?tab=receiving"), true);
    assert.equal(isReceivingInventoryPath("/admin/receiving-inventory-settings"), true);
    assert.equal(isReceivingInventoryPath("/settings/erp/presets"), false);
    assert.equal(isReceivingInventoryPath("/inventory-report"), false);
    assert.equal(isReceivingInventoryPath("/quality-inspection-reports"), false);
  });

  it("hides menu rows, search results and pins while off and shows them when on", () => {
    assert.equal(hideReceivingInventoryTarget(false, { key: "inventory", path: "/inventory" }), true);
    assert.equal(hideReceivingInventoryTarget(undefined, { key: "pin-x", path: "/erp/3" }), true);
    assert.equal(hideReceivingInventoryTarget(undefined, { key: "receiving_inventory" }), true);
    assert.equal(hideReceivingInventoryTarget(true, { key: "inventory", path: "/inventory" }), false);
    assert.equal(hideReceivingInventoryTarget(false, { key: "ncr", path: "/ncr" }), false);
  });
});
