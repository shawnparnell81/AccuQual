import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dueTone, formulaSerial, shownCell, type StoredSheet } from "./controlledListMath.ts";

interface ParityRow {
  addr: string;
  g: number | null;
  h: string | null;
  serial: number;
}

const parity = JSON.parse(readFileSync(new URL("../../../../services/api/src/modules/controlled-lists/seeds/formula-parity.json", import.meta.url), "utf8")) as ParityRow[];

function sheetFor(row: ParityRow): StoredSheet {
  const line = Number(row.addr.slice(1));
  return {
    name: "LST-EQP-001 - Master Equipment ",
    maxRow: line,
    maxCol: 10,
    colWidths: [],
    rowHeights: {},
    merges: [],
    cells: {
      [`G${line}`]: { v: row.g, kind: "input" },
      [`H${line}`]: { v: row.h, kind: "input", nf: "mm-dd-yy" },
      [row.addr]: { f: `H${line}+(G${line}*30)`, nf: "mm-dd-yy", kind: "formula" },
    },
  };
}

describe("controlled list Excel math", () => {
  it("matches the workbook's cached due-date serials", () => {
    assert.equal(parity.length, 59);
    for (const row of parity) {
      const sheet = sheetFor(row);
      assert.equal(formulaSerial(sheet, sheet.cells[row.addr]?.f ?? ""), row.serial, row.addr);
    }
  });

  it("paints overdue red and the next 30 days yellow", () => {
    const today = new Date("2026-10-07T12:00:00Z");
    const soon = formulaSerial(sheetFor({ addr: "I6", g: 0, h: "2026-10-20", serial: 0 }), "H6+(G6*30)");
    const late = formulaSerial(sheetFor({ addr: "I6", g: 0, h: "2026-01-26", serial: 0 }), "H6+(G6*30)");
    assert.equal(soon == null ? null : dueTone(soon, today), "soon");
    assert.equal(late == null ? null : dueTone(late, today), "overdue");
    const sheet = sheetFor(parity[0]!);
    assert.match(shownCell(sheet, "I6", today).text, /^\d{2}-\d{2}-\d{2}$/);
  });
});
