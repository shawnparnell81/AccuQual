import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { blankCell, cellPaint, cellValueProblem, clampSize, effectiveCellType, gridFromImport, inkOnFill, screenCellColors, type FormCell, type FormSheet } from "./formGrid.ts";
import { applyBorders, deleteColumns, deleteRows, formulasReferencing, insertColumns, insertRows, styleFlagOn, toggleStyleFlag } from "./formGridEdit.ts";
import { newRevisionProblem } from "./formRevision.ts";

const here = dirname(fileURLToPath(import.meta.url));

function cssBlock(css: string, marker: string): Record<string, string> {
  const start = css.indexOf(marker);
  assert.ok(start >= 0, marker);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const vars: Record<string, string> = {};
  for (const line of css.slice(open + 1, close).split("\n")) {
    const match = /^\s*(--[\w-]+):\s*([^;]+);/.exec(line);
    if (match?.[1] && match[2]) vars[match[1]] = match[2].trim();
  }
  return vars;
}

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function parseColor(input: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(input);
  if (hex?.[1]) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const match = /^(\d+) (\d+)% (\d+)%$/.exec(input);
  assert.ok(match, input);
  const h = Number(match[1]) / 360;
  const s = Number(match[2]) / 100;
  const l = Number(match[3]) / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function contrast(a: string, b: string): number {
  const lum = (color: string) => {
    const [r, g, b] = parseColor(color);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const hi = Math.max(lum(a), lum(b));
  const lo = Math.min(lum(a), lum(b));
  return (hi + 0.05) / (lo + 0.05);
}

function themeInk(marker: string): { background: string; foreground: string } {
  const css = readFileSync(join(here, "../styles/globals.css"), "utf8");
  const vars = cssBlock(css, marker);
  assert.ok(vars["--card"] && vars["--foreground"], marker);
  return { background: vars["--card"]!, foreground: vars["--foreground"]! };
}

function filled(background: string, extra: Partial<FormCell> = {}): FormCell {
  const cell = blankCell();
  cell.style = { ...cell.style, background };
  return { ...cell, ...extra, style: { ...cell.style, ...extra.style } };
}

describe("form builder dark-mode contrast", () => {
  const dark = themeInk(':root[data-theme="dark"]');

  it("keeps default cells and filled cells readable in dark mode without storing new colors", () => {
    const empty = blankCell();
    const before = JSON.stringify(empty);
    const plain = screenCellColors(empty, "", dark);
    assert.equal(plain.background, dark.background);
    assert.equal(plain.color, dark.foreground);
    assert.ok(contrast(plain.color, plain.background) >= 4.5);
    assert.equal(JSON.stringify(empty), before);

    const header = filled("#0A3C7B");
    const headerBefore = JSON.stringify(header);
    const headerInk = screenCellColors(header, "DMA", dark);
    assert.equal(headerInk.background, "#0A3C7B");
    assert.equal(headerInk.color, "#ffffff");
    assert.equal(header.style.color, undefined);
    assert.ok(contrast(headerInk.color, headerInk.background) >= 4.5, `header ${contrast(headerInk.color, headerInk.background)}`);
    assert.equal(JSON.stringify(header), headerBefore);

    const note = filled("#fff2cc");
    const noteInk = screenCellColors(note, "Note", dark);
    assert.equal(noteInk.color, "#111111");
    assert.ok(contrast(noteInk.color, noteInk.background) >= 4.5);

    const passed = filled("", { conditional: true, value: "Pass" });
    passed.style = {};
    const passInk = screenCellColors(passed, "Pass", dark);
    assert.equal(passInk.background, "#4EA72E");
    assert.equal(passInk.color, inkOnFill("#4EA72E"));
    assert.ok(contrast(passInk.color, passInk.background) >= 4.5, `pass ${contrast(passInk.color, passInk.background)}`);

    const failed = blankCell();
    failed.conditional = true;
    const failInk = screenCellColors(failed, "Fail", dark);
    assert.equal(failInk.background, "#FF0000");
    assert.equal(failInk.color, "#111111");
    assert.ok(contrast(failInk.color, failInk.background) >= 4.5, `fail ${contrast(failInk.color, failInk.background)}`);

    const chosen = filled("#0A3C7B", { style: { background: "#0A3C7B", color: "#fff2cc" } });
    assert.equal(cellPaint(chosen, "DMA").color, "#fff2cc");
    assert.equal(chosen.style.color, "#fff2cc");
  });

  it("uses the theme on screen and keeps print and the file viewer on white paper", () => {
    const css = readFileSync(join(here, "../routes/FormBuilder/formBuilder.css"), "utf8");
    const grid = css.slice(css.indexOf(".fb-grid {"), css.indexOf(".fb-grid th,"));
    assert.match(grid, /background:\s*hsl\(var\(--card\)\)/);
    assert.match(grid, /color:\s*hsl\(var\(--foreground\)\)/);
    assert.doesNotMatch(grid, /#fff|#1a1a1a/);
    const bands = css.slice(css.indexOf(".fb-band,"), css.indexOf("@media print"));
    assert.match(bands, /color:\s*hsl\(var\(--foreground\)\)/);
    assert.match(css, /\.fb-sheet \.fb-formula/);
    assert.match(css, /\.fb-sheet \.fb-color/);
    const print = css.slice(css.indexOf("@media print"));
    assert.match(print, /background:\s*#fff/);
    assert.match(print, /color:\s*#1a1a1a/);

    const chrome = readFileSync(join(here, "../routes/FormBuilder/FormChrome.tsx"), "utf8");
    assert.match(chrome, /fb-sheet/);
    assert.doesNotMatch(chrome, /aq-paper/);
    const office = readFileSync(join(here, "../components/shared/officePreview.css"), "utf8");
    assert.match(office, /background:\s*#fff/);
    const preview = readFileSync(join(here, "../components/shared/InAppFilePreview.tsx"), "utf8");
    assert.match(preview, /aq-paper/);

    const light = themeInk(':root[data-theme="light"]');
    const lightInk = screenCellColors(blankCell(), "", light);
    assert.ok(contrast(lightInk.color, lightInk.background) >= 4.5);
  });
});

/** A sheet where every cell's text is its own address, so a test can see where each one ended up. */
function labeled(rows: number, cols: number): FormSheet {
  return {
    name: "Sheet1",
    colWidths: Array.from({ length: cols }, (_, col) => 100 + col),
    rowHeights: Array.from({ length: rows }, (_, row) => 20 + row),
    cells: Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => ({ ...blankCell(), value: `${row},${col}` }))),
  };
}

function mergeCells(sheet: FormSheet, row: number, col: number, rowSpan: number, colSpan: number): FormSheet {
  const next = JSON.parse(JSON.stringify(sheet)) as FormSheet;
  next.cells[row]![col] = { ...next.cells[row]![col]!, rowSpan, colSpan };
  for (let r = row; r < row + rowSpan; r += 1) {
    for (let c = col; c < col + colSpan; c += 1) if (r !== row || c !== col) next.cells[r]![c] = null;
  }
  return next;
}

const texts = (sheet: FormSheet) => sheet.cells.map((line) => line.map((cell) => (cell ? cell.value : null)));

/** Every covered cell is null, no merge leaves the grid, and no two merges overlap. */
function assertConsistent(sheet: FormSheet) {
  const rows = sheet.rowHeights.length;
  const cols = sheet.colWidths.length;
  assert.equal(sheet.cells.length, rows);
  const owner = new Map<string, string>();
  sheet.cells.forEach((line, row) => {
    assert.equal(line.length, cols);
    line.forEach((cell, col) => {
      if (!cell) return;
      assert.ok(cell.rowSpan >= 1 && cell.colSpan >= 1);
      assert.ok(row + cell.rowSpan <= rows && col + cell.colSpan <= cols, `merge at ${row},${col} leaves the grid`);
      for (let r = row; r < row + cell.rowSpan; r += 1) {
        for (let c = col; c < col + cell.colSpan; c += 1) {
          const key = `${r},${c}`;
          assert.ok(!owner.has(key), `${key} is covered twice`);
          owner.set(key, `${row},${col}`);
          if (r !== row || c !== col) assert.equal(sheet.cells[r]![c], null, `${key} must be null`);
        }
      }
    });
  });
}

describe("grid editing: insert and delete rows and columns", () => {
  it("inserts a blank row above and below, with its own height", () => {
    const sheet = labeled(3, 2);
    const above = insertRows(sheet, 1)!;
    assert.deepEqual(texts(above), [["0,0", "0,1"], ["", ""], ["1,0", "1,1"], ["2,0", "2,1"]]);
    assert.deepEqual(above.rowHeights, [20, 20, 21, 22]);
    const below = insertRows(sheet, 3)!;
    assert.deepEqual(texts(below).at(-1), ["", ""]);
    assert.equal(below.rowHeights.length, 4);
    assertConsistent(above);
    assertConsistent(below);
  });

  it("inserts a column left and right", () => {
    const sheet = labeled(2, 3);
    const left = insertColumns(sheet, 0)!;
    assert.deepEqual(texts(left)[0], ["", "0,0", "0,1", "0,2"]);
    assert.equal(left.colWidths.length, 4);
    const right = insertColumns(sheet, 3)!;
    assert.deepEqual(texts(right)[1], ["1,0", "1,1", "1,2", ""]);
    assertConsistent(left);
    assertConsistent(right);
  });

  it("grows a merge when a row lands inside it, and leaves one it lands beside", () => {
    const sheet = mergeCells(labeled(4, 3), 1, 0, 2, 2);
    const inside = insertRows(sheet, 2)!;
    assert.equal(inside.cells[1]![0]!.rowSpan, 3);
    assert.equal(inside.cells[2]![0], null);
    assert.equal(inside.cells[2]![1], null);
    assert.equal(inside.cells[2]![2]!.value, "");
    assertConsistent(inside);

    const above = insertRows(sheet, 1)!;
    assert.equal(above.cells[2]![0]!.rowSpan, 2);
    assert.equal(above.cells[1]![0]!.value, "");
    assertConsistent(above);

    const after = insertRows(sheet, 3)!;
    assert.equal(after.cells[1]![0]!.rowSpan, 2);
    assert.equal(after.cells[3]![0]!.value, "");
    assertConsistent(after);
  });

  it("grows a merge when a column lands inside it, and shifts one it lands before", () => {
    const sheet = mergeCells(labeled(2, 4), 0, 1, 1, 2);
    const inside = insertColumns(sheet, 2)!;
    assert.equal(inside.cells[0]![1]!.colSpan, 3);
    assert.equal(inside.cells[0]![2], null);
    assert.equal(inside.cells[0]![3], null);
    assertConsistent(inside);
    const before = insertColumns(sheet, 0)!;
    assert.equal(before.cells[0]![2]!.colSpan, 2);
    assertConsistent(before);
  });

  it("deletes a row and moves the rest up", () => {
    const next = deleteRows(labeled(4, 2), 1, 2)!;
    assert.deepEqual(texts(next), [["0,0", "0,1"], ["3,0", "3,1"]]);
    assert.deepEqual(next.rowHeights, [20, 23]);
    assertConsistent(next);
  });

  it("shrinks a merge that loses a row, and drops one that loses them all", () => {
    const sheet = mergeCells(labeled(5, 3), 1, 0, 3, 2);
    const middle = deleteRows(sheet, 2, 2)!;
    assert.equal(middle.cells[1]![0]!.rowSpan, 2);
    assertConsistent(middle);
    const gone = deleteRows(sheet, 1, 3)!;
    assert.deepEqual(texts(gone), [["0,0", "0,1", "0,2"], ["4,0", "4,1", "4,2"]]);
    assertConsistent(gone);
    const last = deleteRows(sheet, 3, 3)!;
    assert.equal(last.cells[1]![0]!.rowSpan, 2);
    assertConsistent(last);
  });

  it("moves a merge up when rows above it go, and keeps its content when its first row is deleted", () => {
    const sheet = mergeCells(labeled(6, 3), 2, 0, 3, 2);
    const above = deleteRows(sheet, 0, 1)!;
    assert.equal(above.cells[0]![0]!.rowSpan, 3);
    assert.equal(above.cells[0]![0]!.value, "2,0");
    assertConsistent(above);
    const first = deleteRows(sheet, 2, 2)!;
    assert.equal(first.cells[2]![0]!.rowSpan, 2);
    assert.equal(first.cells[2]![0]!.value, "2,0");
    assert.equal(first.cells[3]![0], null);
    assertConsistent(first);
  });

  it("deletes columns and shrinks merges across them", () => {
    const sheet = mergeCells(labeled(2, 5), 0, 1, 1, 3);
    const next = deleteColumns(sheet, 2, 2)!;
    assert.equal(next.cells[0]![1]!.colSpan, 2);
    assert.equal(next.colWidths.length, 4);
    assertConsistent(next);
    const edge = deleteColumns(sheet, 0, 1)!;
    assert.equal(edge.cells[0]![0]!.colSpan, 2);
    assert.equal(edge.cells[0]![0]!.value, "0,1");
    assertConsistent(edge);
  });

  it("keeps merges consistent through a run of mixed edits", () => {
    let sheet = mergeCells(mergeCells(labeled(8, 6), 1, 1, 2, 3), 4, 0, 3, 2);
    const steps: Array<(s: FormSheet) => FormSheet | null> = [
      (s) => insertRows(s, 2),
      (s) => deleteColumns(s, 3, 3),
      (s) => insertColumns(s, 1),
      (s) => deleteRows(s, 5, 6),
      (s) => insertRows(s, 0, 2),
      (s) => deleteColumns(s, 0, 0),
    ];
    for (const step of steps) {
      const next = step(sheet);
      assert.ok(next);
      assertConsistent(next);
      sheet = next;
    }
  });

  it("does not mutate the sheet it was given", () => {
    const sheet = mergeCells(labeled(4, 3), 1, 0, 2, 2);
    const before = JSON.stringify(sheet);
    insertRows(sheet, 2);
    deleteRows(sheet, 1, 1);
    insertColumns(sheet, 1);
    deleteColumns(sheet, 0, 0);
    assert.equal(JSON.stringify(sheet), before);
  });

  it("refuses to leave an empty sheet or pass the size limits", () => {
    assert.equal(deleteRows(labeled(2, 2), 0, 1), null);
    assert.equal(deleteColumns(labeled(2, 2), 0, 1), null);
    assert.equal(insertRows(labeled(500, 1), 0), null);
    assert.equal(insertColumns(labeled(1, 60), 0), null);
    assert.ok(insertRows(labeled(499, 1), 0));
  });

  it("points out formulas that refer to deleted rows and columns", () => {
    const sheet = labeled(5, 4);
    sheet.cells[0]![3] = { ...blankCell(), value: "", formula: "SUM(B2:B4)" };
    sheet.cells[1]![3] = { ...blankCell(), value: "", formula: "A5*2" };
    sheet.cells[2]![3] = { ...blankCell(), value: "", formula: "LOG10(C1)" };
    sheet.cells[3]![3] = { ...blankCell(), value: "", formula: "B1+B2" };
    assert.deepEqual(formulasReferencing(sheet, "row", 2, 2), ["D1"]);
    assert.deepEqual(formulasReferencing(sheet, "row", 4, 4), ["D2"]);
    assert.deepEqual(formulasReferencing(sheet, "row", 3, 3), ["D1"]);
    assert.deepEqual(formulasReferencing(sheet, "col", 1, 1), ["D1", "D4"]);
    assert.deepEqual(formulasReferencing(sheet, "col", 2, 2), ["D3"]);
    assert.deepEqual(formulasReferencing(sheet, "col", 0, 0), ["D2"]);
  });
});

describe("grid editing: styles and borders", () => {
  const box = { r1: 0, c1: 0, r2: 1, c2: 1 };

  it("toggles bold, italic and underline on and off", () => {
    let sheet = labeled(2, 2);
    for (const flag of ["bold", "italic", "underline", "wrap"] as const) {
      sheet = toggleStyleFlag(sheet, box, flag);
      assert.ok(styleFlagOn(sheet, box, flag), flag);
      sheet = toggleStyleFlag(sheet, box, flag);
      assert.ok(!styleFlagOn(sheet, box, flag), flag);
      assert.equal(sheet.cells[0]![0]!.style[flag], undefined);
    }
  });

  it("turns a mixed selection fully on first", () => {
    let sheet = labeled(2, 2);
    sheet = toggleStyleFlag(sheet, { r1: 0, c1: 0, r2: 0, c2: 0 }, "bold");
    sheet = toggleStyleFlag(sheet, box, "bold");
    assert.ok(styleFlagOn(sheet, box, "bold"));
  });

  it("sets one side, the outside, all sides, and none", () => {
    const sheet = labeled(3, 3);
    const area = { r1: 0, c1: 0, r2: 2, c2: 2 };
    const top = applyBorders(sheet, area, "top", "thin", "#111111");
    assert.equal(top.cells[0]![1]!.style.borderTop, "1px solid #111111");
    assert.equal(top.cells[1]![1]!.style.borderTop, undefined);
    assert.equal(top.cells[0]![1]!.style.borderBottom, undefined);

    const outside = applyBorders(sheet, area, "outside", "thick", "#ff0000");
    assert.equal(outside.cells[0]![0]!.style.borderTop, "3px solid #ff0000");
    assert.equal(outside.cells[0]![0]!.style.borderLeft, "3px solid #ff0000");
    assert.equal(outside.cells[1]![1]!.style.borderTop, undefined);
    assert.equal(outside.cells[2]![2]!.style.borderRight, "3px solid #ff0000");
    assert.equal(outside.cells[2]![2]!.style.borderBottom, "3px solid #ff0000");

    const all = applyBorders(sheet, area, "all", "dashed", "#00ff00");
    assert.equal(all.cells[1]![1]!.style.borderLeft, "1px dashed #00ff00");
    assert.equal(all.cells[1]![1]!.style.borderBottom, "1px dashed #00ff00");

    const cleared = applyBorders(all, area, "none", "thin", "#000000");
    assert.equal(cleared.cells[1]![1]!.style.borderLeft, undefined);
    assert.equal(cleared.cells[0]![0]!.style.borderTop, undefined);
    assert.equal(JSON.stringify(sheet).includes("border"), false);
  });

  it("treats a merged cell as touching every edge it reaches", () => {
    const sheet = mergeCells(labeled(3, 3), 0, 0, 2, 3);
    const next = applyBorders(sheet, { r1: 0, c1: 0, r2: 1, c2: 2 }, "outside", "double", "#222222");
    const cell = next.cells[0]![0]!.style;
    assert.equal(cell.borderTop, "3px double #222222");
    assert.equal(cell.borderBottom, "3px double #222222");
    assert.equal(cell.borderLeft, "3px double #222222");
    assert.equal(cell.borderRight, "3px double #222222");
  });
});

describe("typed grid cells", () => {
  it("reads a missing type as a label when locked and text when unlocked", () => {
    assert.equal(effectiveCellType({ ...blankCell(), locked: true }), "label");
    assert.equal(effectiveCellType({ ...blankCell(), locked: false }), "text");
    assert.equal(effectiveCellType({ ...blankCell(), type: "number" }), "number");
  });

  it("flags a default value that does not fit, and keeps the text", () => {
    const cell: FormCell = { ...blankCell(), type: "number", value: "abc" };
    assert.equal(cellValueProblem(cell), "Enter a number");
    assert.equal(cell.value, "abc");
    assert.equal(cellValueProblem({ ...cell, value: "12" }), null);
    assert.equal(cellValueProblem({ ...cell, value: "" }), null);
    assert.equal(cellValueProblem({ ...cell, value: "50", max: 10 }), "Enter a number that is 10 or less");
    assert.equal(cellValueProblem({ ...blankCell(), type: "dropdown", options: ["A", "B"], value: "C" }), "Choose one of: A, B");
    assert.equal(cellValueProblem({ ...blankCell(), type: "date", value: "2026-02-30" }), "Enter a date as YYYY-MM-DD");
    assert.equal(cellValueProblem({ ...blankCell(), value: "anything" }), null);
    assert.equal(cellValueProblem({ ...blankCell(), type: "number", formula: "A1+1", value: "" }), null);
  });

  it("keeps imported sizes inside the limits the API accepts", () => {
    assert.equal(clampSize(0, 24), 8);
    assert.equal(clampSize(5000, 24), 1000);
    assert.equal(clampSize(Number.NaN, 24), 24);
    const grid = gridFromImport([{ name: "A", colWidths: [0, 4000, 120], rowHeights: [2, 30], rows: [[{ text: "x", rowSpan: 1, colSpan: 1 }]] } as never]);
    assert.deepEqual(grid.sheets[0]!.colWidths, [8, 1000, 120]);
    assert.deepEqual(grid.sheets[0]!.rowHeights, [8, 30]);
  });
});

describe("revision entry", () => {
  it("blocks an empty or unchanged REV and shows the current one", () => {
    assert.equal(newRevisionProblem("B", ""), "Enter the new revision. It must be different from REV B.");
    assert.equal(newRevisionProblem("B", "  "), "Enter the new revision. It must be different from REV B.");
    assert.equal(newRevisionProblem("B", "b"), "Enter the new revision. It must be different from REV B.");
    assert.equal(newRevisionProblem("B", "C"), null);
    assert.equal(newRevisionProblem("B", "ABCDEFGHIJK"), "The revision can be at most 10 characters.");
  });
});
