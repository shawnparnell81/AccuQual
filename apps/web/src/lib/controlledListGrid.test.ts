import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commitAndReload, gestureFromKey, gestureSavesEdit, headerBandEnd, moveAddr, moveTab, placedCells, type EditGesture } from "./controlledListGrid.ts";

describe("controlled list grid movement", () => {
  const bounds = { minRow: 1, maxRow: 8, maxCol: 4 };

  it("moves with the arrows and stops at the edge", () => {
    assert.equal(moveAddr("B3", "ArrowRight", bounds), "C3");
    assert.equal(moveAddr("B3", "ArrowLeft", bounds), "A3");
    assert.equal(moveAddr("B3", "ArrowUp", bounds), "B2");
    assert.equal(moveAddr("B3", "ArrowDown", bounds), "B4");
    assert.equal(moveAddr("A1", "ArrowLeft", bounds), null);
    assert.equal(moveAddr("A1", "ArrowUp", bounds), null);
    assert.equal(moveAddr("D8", "ArrowRight", bounds), null);
    assert.equal(moveAddr("D8", "ArrowDown", bounds), null);
  });

  it("wraps Tab across the row and Shift+Tab backward", () => {
    assert.equal(moveTab("B3", false, bounds), "C3");
    assert.equal(moveTab("B3", true, bounds), "A3");
    assert.equal(moveTab("D3", false, bounds), "A4");
    assert.equal(moveTab("A3", true, bounds), "D2");
    assert.equal(moveTab("D8", false, bounds), null);
    assert.equal(moveTab("A1", true, bounds), null);
    assert.equal(gestureFromKey("Tab", false), "Tab");
    assert.equal(gestureFromKey("Tab", true), "ShiftTab");
    assert.equal(gestureFromKey("Enter", true), "Enter");
  });

  it("keeps the header band above the column titles", () => {
    assert.equal(headerBandEnd(6), 5);
    assert.equal(headerBandEnd(4), 3);
    assert.equal(headerBandEnd(3), 2);
  });
});

describe("controlled list cell commit", () => {
  const gestures: EditGesture[] = ["Enter", "Tab", "ShiftTab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "blur", "click"];

  it("keeps a Tab commit after reload and drops a draft that was never committed", () => {
    const saved = { cells: { A6: "ECR-2026-001" } };
    const drafted = { saved, pending: {}, draft: { addr: "A6", value: "ECR-TAB-1" } };
    assert.equal(drafted.saved.cells.A6, "ECR-2026-001");
    for (const gesture of gestures) {
      assert.equal(gestureSavesEdit(gesture), true);
      const reloaded = commitAndReload(drafted, gesture);
      assert.equal(reloaded.cells.A6, "ECR-TAB-1", gesture);
    }
    const queued = { saved, pending: { A6: "typed then tabbed" }, draft: null };
    assert.equal(commitAndReload(queued, "Tab").cells.A6, "typed then tabbed");
    assert.equal(saved.cells.A6, "ECR-2026-001");
  });
});

describe("controlled list header placement", () => {
  it("keeps LST-ENG-001 header merges in their columns", () => {
    const merges = ["A4:K4", "A1:K1", "E2:F2", "H2:I2", "A3:D3", "E3:K3"];
    assert.deepEqual(
      placedCells(merges, 11, 1, 1).map((cell) => [cell.addr, cell.col, cell.cols]),
      [["A1", 1, 11]],
    );
    assert.deepEqual(
      placedCells(merges, 11, 2, 2).map((cell) => [cell.addr, cell.col, cell.cols]),
      [
        ["A2", 1, 1],
        ["B2", 2, 1],
        ["C2", 3, 1],
        ["D2", 4, 1],
        ["E2", 5, 2],
        ["G2", 7, 1],
        ["H2", 8, 2],
        ["J2", 10, 1],
        ["K2", 11, 1],
      ],
    );
    assert.deepEqual(
      placedCells(merges, 11, 3, 3).map((cell) => [cell.addr, cell.col, cell.cols]),
      [
        ["A3", 1, 4],
        ["E3", 5, 7],
      ],
    );
    assert.deepEqual(
      placedCells(merges, 11, 4, 4).map((cell) => [cell.addr, cell.cols]),
      [["A4", 11]],
    );
  });

  it("keeps partial header merges on the other standalone lists", () => {
    const cases: Array<{ name: string; merges: string[]; maxCol: number; addr: string; cols: number; row: number }> = [
      { name: "GEN-002 title", merges: ["A1:H1", "F2:H2", "B3:D3", "F3:H3", "A4:H4"], maxCol: 8, addr: "F2", cols: 3, row: 2 },
      { name: "GEN-002 owner", merges: ["A1:H1", "F2:H2", "B3:D3", "F3:H3", "A4:H4"], maxCol: 8, addr: "F3", cols: 3, row: 3 },
      { name: "GEN-002 date", merges: ["A1:H1", "F2:H2", "B3:D3", "F3:H3", "A4:H4"], maxCol: 8, addr: "B3", cols: 3, row: 3 },
      { name: "EQP-001 authorized", merges: ["A1:J1", "A4:J4", "A3:J3", "F2:J2"], maxCol: 10, addr: "F2", cols: 5, row: 2 },
      { name: "NCR date", merges: ["A1:K1", "G2:K2", "A3:K3"], maxCol: 11, addr: "G2", cols: 5, row: 2 },
      { name: "DEV location", merges: ["A1:H1", "F2:G2", "A3:H3", "C2:D2"], maxCol: 8, addr: "C2", cols: 2, row: 2 },
      { name: "DEV approved", merges: ["A1:H1", "F2:G2", "A3:H3", "C2:D2"], maxCol: 8, addr: "F2", cols: 2, row: 2 },
      { name: "DEV validation date", merges: ["F2:G2", "H2:I2", "C2:D2", "A1:I1", "A3:I3"], maxCol: 9, addr: "H2", cols: 2, row: 2 },
      { name: "GEN-003 data pair", merges: ["A1:F1", "A4:F4", "E6:F6"], maxCol: 6, addr: "E6", cols: 2, row: 6 },
      { name: "GEN-001 title", merges: ["A1:H1"], maxCol: 8, addr: "A1", cols: 8, row: 1 },
    ];
    for (const item of cases) {
      const placed = placedCells(item.merges, item.maxCol, item.row, item.row);
      const cell = placed.find((entry) => entry.addr === item.addr);
      assert.equal(cell?.cols, item.cols, item.name);
      const covered = item.addr.replace(/\d+$/, "");
      const nextCol = String.fromCharCode(covered.charCodeAt(0) + 1);
      if (item.cols > 1) assert.equal(placed.some((entry) => entry.addr === `${nextCol}${item.row}`), false, item.name);
    }
  });
});