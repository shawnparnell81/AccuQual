import { DEFAULT_INSPECTOR } from "../../validationReport";
import { addCell, addStyle, buildForm, type Cells } from "../formModule";
import { airStrutLayout } from "../layouts/air-strut.layout";
import type { WorkbookLayout } from "../layoutTypes";

/**
 * FRM-VAL-010 Air Strut Validation Document, Rev A. Drawn from FRM-VAL-010-Air-Strut-RevA.xlsx (its tab says FRM-DEV-006 Air
 * Strut Develop by mistake; the form is FRM-VAL-010).
 *
 * Ported as written: the H13-H30 "ABS(F-B)<=D" rows, the ride-height cells B28/B29/B30/F29/F30, the damping Pass/Fail
 * D40:H65 for each state, the weights F79:F82 and the G7 rollup. The workbook's "blank = Fail" behavior and its
 * Pass/Fail and PASS/FAIL words are kept.
 *
 * Differences from the workbook (each is one entry in `formulas` below):
 *  - rows 15, 18, 19 (nominal and tolerance "NA") had no result: they show Pass (the NA rule the other forms use).
 *  - rows 16, 17 (mounting type text, "1 STUD" vs "1 Stud") used the numeric ABS formula and errored: Pass when F matches B
 *    (trimmed, any case); blank is still Fail.
 *  - damping: when a state's whole Nominal block (its two Nominal rows, D:H) is blank, that state's Pass/Fail cells are blank
 *    and drop out of the G7/B84 rollup, so a part with no state 3 or 4 can pass. The state's Amps text (B34/B42/B50/B58) is
 *    an editable field.
 *  - rows 69-75 (electronics and hardware) had no result: "NA" nominal gives Pass; a text nominal (row 73) is Pass when E
 *    matches B (blank is Fail). Row 69 (1.3 Ohms) has no tolerance on the form, so it has no result and is not in the rollup;
 *    its H69 cell shows the hint "No tolerance on form".
 *  - B84 is G7, so the header result and the final disposition result are one rollup (the workbook typed the same formula
 *    twice).
 *  - rows 24-27 have no result cell in the workbook and still have none (H24:H27 are locked).
 *
 * Kept as written, and open for review: row 20 paint 40 with tolerance 100 (range -60 to 140, so it passes almost anything);
 * rows 29-30 have no tolerance in D until one is typed, so they Fail until then; rows 24-27 have no result cell; F79:F82 only
 * check that a value was entered.
 */
const AIR_STRUT_CERTIFY = "I certify that this air strut validation is accurate and I authorize the disposition.";

const PASS = "Pass";
const FAIL = "Fail";

/** The workbook's own formula for a cell, so an override can wrap it instead of retyping it. */
function workbookFormula(at: string): string {
  const formula = airStrutLayout.cells[at]?.f;
  if (!formula) throw new Error(`The air strut workbook has no formula at ${at}`);
  return formula;
}

const formulas: Record<string, string | null> = {};

// Rows 15, 18, 19: nominal and tolerance are "NA", so the row passes. They had no result in the workbook.
for (const row of [15, 18, 19]) {
  formulas[`H${row}`] = `IF(AND(B${row}="NA",D${row}="NA"),"${PASS}",IF(OR(B${row}="",D${row}="",F${row}=""),"${FAIL}",IF(ABS(F${row} - B${row}) <= D${row},"${PASS}","${FAIL}")))`;
}

// Rows 16, 17: text, not a number. Pass when the sample matches the nominal (trimmed, any case).
for (const row of [16, 17]) formulas[`H${row}`] = `IF(OR(B${row}="",F${row}=""),"${FAIL}",IF(TRIM(F${row})=TRIM(B${row}),"${PASS}","${FAIL}"))`;

// Damping: a state whose whole Nominal block is blank has no result and is left out of the rollup.
const STATES = [
  { nominal: [34, 35], rows: [40, 41] },
  { nominal: [42, 43], rows: [48, 49] },
  { nominal: [50, 51], rows: [56, 57] },
  { nominal: [58, 59], rows: [64, 65] },
];
for (const state of STATES) {
  for (const row of state.rows) {
    for (const col of ["D", "E", "F", "G", "H"]) {
      const at = `${col}${row}`;
      formulas[at] = `IF(COUNTA(D${state.nominal[0]}:H${state.nominal[1]})=0,"",${workbookFormula(at)})`;
    }
  }
}

// Electronics and hardware. Row 69 (1.3 Ohms) has no tolerance on the form: no result, left out of the rollup.
for (const row of [70, 71, 72, 74, 75]) formulas[`H${row}`] = `IF(B${row}="NA","${PASS}","")`;
formulas.H73 = `IF(B73="NA","${PASS}",IF(OR(B73="",E73=""),"${FAIL}",IF(TRIM(E73)=TRIM(B73),"${PASS}","${FAIL}")))`;

// One rollup for the header (G7) and the final disposition (B84).
formulas.B84 = "G7";

/** Adds the "No tolerance on form" hint to H69, in the cell's own style but small, italic and gray. */
function addHint(layout: WorkbookLayout): WorkbookLayout {
  const base = layout.styles[layout.cells.H69?.s ?? 0] ?? {};
  const { layout: styled, index } = addStyle(layout, { ...base, i: 1, sz: 9, fg: "#666666", h: "center", v: "middle" });
  return addCell(styled, "H69", { v: "No tolerance on form", s: index });
}

const defaults: Cells = {
  B8: DEFAULT_INSPECTOR,
  // The workbook left an example in these two samples; a blank form must not pass on it.
  F16: "",
  F17: "",
  B34: String(airStrutLayout.cells.B34?.v ?? ""),
  B42: String(airStrutLayout.cells.B42?.v ?? ""),
  B50: String(airStrutLayout.cells.B50?.v ?? ""),
  B58: String(airStrutLayout.cells.B58?.v ?? ""),
};

export const AIR_STRUT_FORM = buildForm({
  type: "air_strut",
  docId: "FRM-VAL-010",
  title: "FRM-VAL-010 AIR STRUT VALIDATION DOCUMENT",
  revision: "A",
  passFill: "#0EBB5F",
  words: { pass: PASS, fail: FAIL },
  layout: airStrutLayout,
  docIdCell: "A2",
  revCell: "B2",
  patchLayout: addHint,
  formulas,
  // The sample for the two mounting types is typed text (the workbook left an example in the cell); the Amps text of each
  // damping state is editable.
  inputs: ["F16", "F17", "B34", "B42", "B50", "B58"],
  // Empty cells that are not places to type: the corner cells of the tables, the pneumatic rows' missing result column and
  // the blank rows at the end.
  locked: ["A33", "A68", "A87", "A88", "H24", "H25", "H26", "H27"],
  ticks: ["F84"],
  defaults,
  signatures: [{ addr: "B85", path: "authorizedSignature", certify: AIR_STRUT_CERTIFY }],
  resultCells: ["G7", "B84"],
});
