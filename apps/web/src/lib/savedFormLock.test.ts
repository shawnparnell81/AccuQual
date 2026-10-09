import assert from "node:assert/strict";
import test from "node:test";
import { afterEditClick, afterSaveOrCancel, openSavedForm, savedFieldsEditable } from "./savedFormLock.ts";

test("a saved form opens read-only, Edit unlocks it, and Save or Cancel locks it again", () => {
  const opened = openSavedForm();
  assert.equal(opened, "locked");
  assert.equal(savedFieldsEditable(opened, true), false);

  const editing = afterEditClick(true);
  assert.equal(editing, "editing");
  assert.equal(savedFieldsEditable(editing, true), true);

  const saved = afterSaveOrCancel();
  assert.equal(saved, "locked");
  assert.equal(savedFieldsEditable(saved, true), false);
});

test("someone without edit permission stays on the locked form", () => {
  assert.equal(afterEditClick(false), "locked");
  assert.equal(savedFieldsEditable("editing", false), false);
});
