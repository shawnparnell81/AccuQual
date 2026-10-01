import assert from "node:assert/strict";
import test from "node:test";
import { supplierOrderBlocked } from "./supplierOrder.ts";

test("only disqualified and suspended suppliers are blocked on an order", () => {
  assert.equal(supplierOrderBlocked("active"), false);
  assert.equal(supplierOrderBlocked("probation"), false);
  assert.equal(supplierOrderBlocked("disqualified"), true);
  assert.equal(supplierOrderBlocked("suspended"), true);
  assert.equal(supplierOrderBlocked(" Suspended "), true);
});
