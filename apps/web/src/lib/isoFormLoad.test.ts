import assert from "node:assert/strict";
import test from "node:test";
import { formByType } from "./isoFormCatalog";
import { isoCell, isoCells, isoDataBag } from "./isoFormLoad";

test("a saved form key or form id still opens the NCR sheet", () => {
  assert.equal(formByType("ncr_report")?.formKey, "frm-ncr-001");
  assert.equal(formByType("frm-ncr-001")?.formType, "ncr_report");
  assert.equal(formByType("FRM-NCR-001")?.formType, "ncr_report");
  assert.equal(formByType("not-a-form"), undefined);
});

test("odd cells stay as text and unreadable data is left unread", () => {
  assert.equal(isoCell({ note: "kept" }), '{"note":"kept"}');
  assert.deepEqual(isoCells({ B3: { note: "kept" }, B4: true }), { B3: '{"note":"kept"}', B4: true });
  assert.deepEqual(isoDataBag('{"cells":{"B3":"ok"}}'), { cells: { B3: "ok" } });
  assert.equal(isoDataBag("{"), null);
});
