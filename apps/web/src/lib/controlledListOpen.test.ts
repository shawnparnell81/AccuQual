import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { clickOpensCell, keyOpensCell } from "./controlledListOpen";

/** Plays a click on a cell and then typed keys the way the Master list grid does, and returns the text that ends up in the cell. */
function clickThenType(stored: string, cell: { editable: boolean; formula: boolean; choices?: boolean; date?: boolean }, clickTag: string, keys: string) {
  let open = false;
  let text = stored;
  if (clickOpensCell(cell, { targetTag: clickTag, shiftKey: false })) open = true;
  for (const key of keys) {
    if (!open) {
      const opened = keyOpensCell({ key }, { choices: Boolean(cell.choices), date: Boolean(cell.date) });
      if (!opened.open) continue;
      open = true;
      if (opened.seed) text += opened.seed;
      continue;
    }
    text += key;
  }
  return { open, text };
}

describe("Master Equipment List cells open on click and take typing", () => {
  const text = { editable: true, formula: false };
  for (const [addr, stored, tag] of [
    ["A7 (blank ID)", "", "DIV"],
    ["B7 (blank name)", "", "BUTTON"],
    ["C10 manufacturer", "CTW", "BUTTON"],
    ["D12 serial", "808", "DIV"],
    ["E15 location", "Wellman-LAB", "BUTTON"],
    ["F20 method", "", "DIV"],
  ] as const) {
    it(`${addr}: a click on the cell or its padding opens it and typing lands in it`, () => {
      const result = clickThenType(stored, text, tag, "abc");
      assert.equal(result.open, true);
      assert.equal(result.text, `${stored}abc`);
    });
  }

  it("keeps the first key when typing starts on a selected, closed cell", () => {
    assert.deepEqual(keyOpensCell({ key: "x" }, { choices: false, date: false }), { open: true, seed: "x" });
    assert.deepEqual(keyOpensCell({ key: "F2" }, { choices: false, date: false }), { open: true });
    assert.deepEqual(keyOpensCell({ key: "x" }, { choices: true, date: false }), { open: true });
    assert.deepEqual(keyOpensCell({ key: "c", ctrlKey: true }, { choices: false, date: false }), { open: false });
  });

  it("leaves formula cells, read-only users, shift-select and open fields alone", () => {
    assert.equal(clickOpensCell({ editable: true, formula: true }, { targetTag: "DIV", shiftKey: false }), false);
    assert.equal(clickOpensCell({ editable: false, formula: false }, { targetTag: "DIV", shiftKey: false }), false);
    assert.equal(clickOpensCell(text, { targetTag: "DIV", shiftKey: true }), false);
    assert.equal(clickOpensCell(text, { targetTag: "input", shiftKey: false }), false);
  });

  it("draws a blank closed cell as a full-height target and wires the click on the whole cell", () => {
    const css = readFileSync(new URL("../routes/Documents/controlledList.css", import.meta.url), "utf8");
    const pick = css.slice(css.indexOf(".controlled-list-pick {"), css.indexOf("}", css.indexOf(".controlled-list-pick {")));
    assert.match(pick, /align-self: stretch/);
    assert.match(pick, /min-height: 1em/);
    const page = readFileSync(new URL("../routes/Documents/ControlledListPage.tsx", import.meta.url), "utf8");
    assert.match(page, /clickOpensCell\(\{ editable, formula \}/);
    assert.match(page, /keyOpensCell\(event/);
  });
});
