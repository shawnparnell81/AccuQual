import { DEFAULT_INSPECTOR } from "../../validationReport";
import { buildForm } from "../formModule";
import { shockLayout } from "../layouts/shock.layout";
import { allFilled, overallOf, withinTolerance, withinToleranceAsWritten, type Words } from "../rules";

/**
 * FRM-VAL-002 Shock Validation Report, Rev B. Drawn from FRM-VAL-002-Shock-RevB.xlsx.
 *
 * Differences from the workbook (everything else is the workbook's own formula, ported as written):
 *  - rows 22,23,25,26,27,28,30,31 get a Passed/Failed in G and H (within C±D), like row 24 already had; row 10 gets a
 *    Passed/Failed dropdown. Their gray "n/a" fill is taken off.
 *  - H24 and H29 (sample 2 on rows 24 and 29) had no formula in the workbook; they now match G.
 *  - workbook bugs fixed: H11 tested F11=10 (now C11±D11), H35-H37 pointed at the next row's D and the row's own E
 *    (now C±D of their own row), G37 tested F37 for the upper bound (now E37).
 *  - rows 41 and 42 tick Pass/Fail themselves from the G (sample 1) and H (sample 2) results; row 43 follows A3.
 *    Conditional Pass stays a manual tick.
 *  - the overall result (A3) stays blank until every graded row has a result.
 *  - Approved By (F6) and Engineer who Approved Conditional Pass (G44) are PIN signature stamps.
 * Row 18 stays as written (E>=C: a minimum thickness).
 */
export const SHOCK_WORDS: Words = { pass: "Passed", fail: "Failed" };

/** Rows where the sample result is a pass/fail dropdown a person picks (row 10, visual inspection). */
const MANUAL_ROW = 10;
/** Rows that are measured against C and D. Row 16's C is a formula; row 18 is a minimum (E>=C). */
const MEASURED_ROWS = [11, 15, 16, 17, 18, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 35, 36, 37, 38];
/** Rows that did not have a result formula in the workbook (24 and 29 did). */
const NEW_RESULT_ROWS = [22, 23, 25, 26, 27, 28, 30, 31];
const FIXED_BAND_ROWS = [35, 36, 37];

function column(letter: "E" | "F"): string[] {
  return MEASURED_ROWS.map((row) => `${letter}${row}`);
}

const resultCells = (letter: "G" | "H") => [`${letter}${MANUAL_ROW}`, ...MEASURED_ROWS.map((row) => `${letter}${row}`)];
const requiredFor = (measureLetter: "E" | "F", resultLetter: "G" | "H") => [`${resultLetter}${MANUAL_ROW}`, ...column(measureLetter)];

const formulas: Record<string, string> = {};
for (const row of NEW_RESULT_ROWS) {
  formulas[`G${row}`] = withinTolerance(`E${row}`, `C${row}`, `D${row}`, SHOCK_WORDS);
  formulas[`H${row}`] = withinTolerance(`F${row}`, `C${row}`, `D${row}`, SHOCK_WORDS);
}
// Rows 24 and 29 had a sample 1 result (G) but no sample 2 result (H) in the workbook; they get one so sample 2 can be graded.
formulas.H24 = withinTolerance("F24", "C24", "D24", SHOCK_WORDS);
formulas.H29 = withinTolerance("F29", "C29", "D29", SHOCK_WORDS);
// Workbook bugs, corrected.
formulas.H11 = withinToleranceAsWritten("F11", "C11", "D11", SHOCK_WORDS);
for (const row of FIXED_BAND_ROWS) formulas[`H${row}`] = withinToleranceAsWritten(`F${row}`, `C${row}`, `D${row}`, SHOCK_WORDS);
formulas.G37 = withinToleranceAsWritten("E37", "C37", "D37", SHOCK_WORDS);

const required1 = requiredFor("E", "G");
const required2 = requiredFor("F", "H");
const allRequired = [...required1, ...required2];

// Overall and per-sample dispositions.
formulas.A3 = overallOf(allRequired, [...resultCells("G"), ...resultCells("H")], SHOCK_WORDS);
const failedIn = (letter: "G" | "H") => `COUNTIF(${letter}${MANUAL_ROW}:${letter}38,"${SHOCK_WORDS.fail}")`;
formulas.B41 = `AND(${allFilled(required1)},${failedIn("G")}=0)`;
formulas.D41 = `AND(${allFilled(required1)},${failedIn("G")}>0)`;
formulas.B42 = `AND(${allFilled(required2)},${failedIn("H")}=0)`;
formulas.D42 = `AND(${allFilled(required2)},${failedIn("H")}>0)`;
formulas.B43 = `A3="${SHOCK_WORDS.pass}"`;
formulas.D43 = `A3="${SHOCK_WORDS.fail}"`;

export const SHOCK_FORM = buildForm({
  type: "shock",
  docId: "FRM-VAL-002",
  title: "FRM-VAL-002 SHOCK VALIDATION REPORT",
  revision: "B",
  passFill: "#4EA72E",
  words: SHOCK_WORDS,
  layout: shockLayout,
  docIdCell: "A2",
  revCell: "B2",
  formulas,
  inputs: ["F5"],
  // Notes in 5.0 Final Conclusion spans two rows: a text area.
  areas: ["B44"],
  lists: {
    G10: [SHOCK_WORDS.pass, SHOCK_WORDS.fail],
    H10: [SHOCK_WORDS.pass, SHOCK_WORDS.fail],
  },
  clearFill: [
    "G10",
    "H10",
    ...NEW_RESULT_ROWS.flatMap((row) => [`D${row}`, `G${row}`, `H${row}`]),
  ],
  // The workbook's Approved By box and the Conditional Pass engineer box are PIN sign-offs, like the other validation forms.
  signatures: [
    { addr: "F6", path: "authorizedSignature", certify: "I certify that this shock validation is accurate and I approve it." },
    { addr: "G44", path: "furtherSignature", certify: "I certify that I reviewed this shock and I approve the conditional pass." },
  ],
  defaults: { F5: DEFAULT_INSPECTOR },
  resultCells: ["A3"],
});
