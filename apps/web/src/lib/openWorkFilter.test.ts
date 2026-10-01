import assert from "node:assert/strict";
import test from "node:test";
import { cardFilterKeys, filterToken, rowInModuleFilter } from "./openWorkFilter";

test("a single-module card still filters that one type", () => {
  const keys = cardFilterKeys({ href: "/ncr", module: "NCR", modules: null });
  assert.deepEqual(keys, ["NCR"]);
  assert.equal(filterToken(keys!), "NCR");
  assert.equal(rowInModuleFilter("NCR", "NCR"), true);
  assert.equal(rowInModuleFilter("CAPA", "NCR"), false);
});

test("open validation filters validation, FAI, and TRP together", () => {
  const keys = cardFilterKeys({ href: null, module: null, modules: ["VAL", "FAI", "TRP"] });
  assert.deepEqual(keys, ["VAL", "FAI", "TRP"]);
  const token = filterToken(keys!);
  assert.equal(rowInModuleFilter("VAL", token), true);
  assert.equal(rowInModuleFilter("FAI", token), true);
  assert.equal(rowInModuleFilter("TRP", token), true);
  assert.equal(rowInModuleFilter("ECR", token), false);
});

test("open ECRs filter ECR forms and change requests together", () => {
  const keys = cardFilterKeys({ href: null, module: null, modules: ["ECR", "Change"] });
  assert.deepEqual(keys, ["ECR", "Change"]);
  const token = filterToken(keys!);
  assert.equal(rowInModuleFilter("ECR", token), true);
  assert.equal(rowInModuleFilter("Change", token), true);
  assert.equal(rowInModuleFilter("VAL", token), false);
});

test("a card with only a link does not filter the table", () => {
  assert.equal(cardFilterKeys({ href: "/calibration", module: null }), null);
  assert.equal(rowInModuleFilter("NCR", ""), true);
});
