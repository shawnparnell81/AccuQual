import assert from "node:assert/strict";
import test from "node:test";
import { isEditableFocusTarget } from "./editableFocus.ts";

function el(tagName: string, extra: Record<string, unknown> = {}, parent: unknown = null) {
  return {
    tagName,
    isContentEditable: false,
    getAttribute: () => null,
    parentElement: parent,
    ...extra,
  };
}

test("slash and other shortcuts ignore every editable field", () => {
  assert.equal(isEditableFocusTarget(el("INPUT")), true);
  assert.equal(isEditableFocusTarget(el("TEXTAREA")), true);
  assert.equal(isEditableFocusTarget(el("SELECT")), true);
  assert.equal(isEditableFocusTarget(el("INPUT", { getAttribute: (name: string) => (name === "type" ? "date" : null) })), true);
  assert.equal(isEditableFocusTarget(el("DIV", { isContentEditable: true })), true);
  assert.equal(isEditableFocusTarget(el("DIV", { getAttribute: (name: string) => (name === "role" ? "textbox" : null) })), true);
  const editor = el("DIV", { isContentEditable: true });
  assert.equal(isEditableFocusTarget({ nodeType: 3, parentElement: editor }), true);
  assert.equal(isEditableFocusTarget(el("BUTTON")), false);
  assert.equal(isEditableFocusTarget(el("DIV")), false);
  assert.equal(isEditableFocusTarget(null), false);
});
