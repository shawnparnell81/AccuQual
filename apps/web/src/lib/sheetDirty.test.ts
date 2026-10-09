import assert from "node:assert/strict";
import test from "node:test";
import { sheetIsDirty, sheetSnap } from "./sheetDirty.ts";

test("a loaded sheet is clean, and a successful save clears the dirty flag", () => {
  const loaded = sheetSnap({ cells: { B6: "saved text" } });
  const edited = sheetSnap({ cells: { B6: "typed" } });
  assert.equal(sheetIsDirty(9, loaded, null), false);
  assert.equal(sheetIsDirty(9, loaded, { id: 9, snap: loaded }), false);
  assert.equal(sheetIsDirty(9, edited, { id: 9, snap: loaded }), true);
  assert.equal(sheetIsDirty(9, edited, { id: 9, snap: edited }), false);
  assert.equal(sheetIsDirty(9, edited, { id: 4, snap: edited }), false);
  assert.equal(sheetSnap({ cells: { B7: "b", B6: "a" } }), sheetSnap({ cells: { B6: "a", B7: "b" } }));
});
