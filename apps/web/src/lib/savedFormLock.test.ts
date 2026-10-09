import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SavedFormLockBar } from "../components/forms/SavedFormLockBar.tsx";
import { afterEditClick, afterSaveOrCancel, isFreshFormOpen, openSavedForm, savedFieldsEditable } from "./savedFormLock.ts";

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
  assert.equal(openSavedForm(true), "editing");
  assert.equal(isFreshFormOpen({ freshForm: true }), true);
  assert.equal(isFreshFormOpen(null), false);
});

test("a new blank shows Save and a reopened record shows Edit", () => {
  const noop = () => undefined;
  const fresh = renderToStaticMarkup(
    createElement(SavedFormLockBar, { mode: openSavedForm(true), canEdit: true, onEdit: noop, onSave: noop, onCancel: noop, onDone: noop }),
  );
  assert.match(fresh, /data-testid="form-save"/);
  assert.equal(fresh.includes('data-testid="form-edit"'), false);

  const reopened = renderToStaticMarkup(
    createElement(SavedFormLockBar, { mode: openSavedForm(false), canEdit: true, onEdit: noop, onSave: noop, onCancel: noop, onDone: noop }),
  );
  assert.match(reopened, /data-testid="form-edit"/);
  assert.equal(reopened.includes('data-testid="form-save"'), false);
});
