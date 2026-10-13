import assert from "node:assert/strict";
import test from "node:test";
import { afterEditClick, editClickAction, openSavedForm, opensFresh, savedFieldsEditable } from "./savedFormLock.ts";

/**
 * Regression: inside a workspace tab the router state is always null, so a blank opened from Blank Forms
 * (e.g. FRM-VAL-003 Air Compressor, no saved copies) opened locked, and Edit returned early because the
 * draft has no record id yet: a dead Edit button.
 */
test("a blank-opened draft opens editable even with null router state, and Edit unlocks it without begin-edit", () => {
  const fresh = opensFresh(null, true);
  assert.equal(fresh, true);
  assert.equal(savedFieldsEditable(openSavedForm(fresh), true), true);
  // Even if it were locked, Edit must do something on a draft.
  assert.equal(editClickAction(true, "locked", true), "unlock");
  assert.equal(savedFieldsEditable(afterEditClick(true), true), true);
});

test("a saved form opens locked and Edit toggles it editable through begin-edit", () => {
  const fresh = opensFresh(null, false);
  assert.equal(fresh, false);
  const mode = openSavedForm(fresh);
  assert.equal(savedFieldsEditable(mode, true), false);
  assert.equal(editClickAction(true, mode, false), "begin-edit");
  assert.equal(savedFieldsEditable(afterEditClick(true), true), true);
  assert.equal(opensFresh({ freshForm: true }, false), true);
});

test("Edit does nothing without edit permission or when already editing", () => {
  assert.equal(editClickAction(false, "locked", false), "none");
  assert.equal(editClickAction(false, "locked", true), "none");
  assert.equal(editClickAction(true, "editing", false), "none");
  assert.equal(savedFieldsEditable(openSavedForm(opensFresh(null, true)), false), false);
});

import { isUnsavedRecordId, shouldStartBlank } from "./blankDraft.ts";

test("Delete on a blank-opened draft discards locally instead of calling DELETE /…/NaN; saved records still delete", () => {
  assert.equal(isUnsavedRecordId(Number("new")), true);
  assert.equal(isUnsavedRecordId(0), true);
  assert.equal(isUnsavedRecordId(42), false);
});

test("Back/Delete are not hijacked: the kept Blank Forms start page hands off only once per mount", () => {
  assert.equal(shouldStartBlank(null, "frm-val-003"), true);
  // After handing off, a templates refetch re-runs the effect; it must not navigate back onto the blank.
  assert.equal(shouldStartBlank("frm-val-003", "frm-val-003"), false);
  assert.equal(shouldStartBlank("frm-val-003", "frm-val-001"), true);
  assert.equal(shouldStartBlank(null, ""), false);
});
