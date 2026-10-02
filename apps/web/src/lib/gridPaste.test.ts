import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isMultiCellPaste, normalizePastedCell, parseClipboardGrid, pasteIntoMatrix, selectionToTsv } from "./gridPaste";

describe("spreadsheet paste", () => {
  it("parses a copied block and ignores a trailing newline", () => {
    const grid = parseClipboardGrid("Ada\t2026-04-01\nBea\t2026-04-02\n");
    assert.deepEqual(grid, [
      ["Ada", "2026-04-01"],
      ["Bea", "2026-04-02"],
    ]);
    assert.equal(isMultiCellPaste(grid), true);
    assert.equal(isMultiCellPaste([["Ada"]]), false);
  });

  it("keeps a quoted cell together", () => {
    assert.deepEqual(parseClipboardGrid('"Say ""hi""\tthere"\tnext'), [['Say "hi"\tthere', "next"]]);
  });

  it("fills down and across from the focused cell", () => {
    const next = pasteIntoMatrix(
      [
        ["a", "b", "c"],
        ["d", "e", "f"],
      ],
      0,
      1,
      [
        ["1", "2"],
        ["3", "4"],
      ],
    );
    assert.deepEqual(next, [
      ["a", "1", "2"],
      ["d", "3", "4"],
    ]);
  });

  it("turns a pasted date into YYYY-MM-DD and leaves other text alone", () => {
    assert.equal(normalizePastedCell("4/2/2026", "date"), "2026-04-02");
    assert.equal(normalizePastedCell("Quality", "date"), "Quality");
    assert.equal(normalizePastedCell("", "date"), "");
    assert.equal(normalizePastedCell("4/2/2026", "text"), "4/2/2026");
  });

  it("copies a selected rectangle", () => {
    const text = selectionToTsv(
      [
        ["A", "1"],
        ["B", "2"],
      ],
      [
        [false, true],
        [false, true],
      ],
    );
    assert.equal(text, "1\n2");
  });
});
