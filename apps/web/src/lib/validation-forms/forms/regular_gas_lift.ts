import { isError, type Value } from "../engine";
import { addCell, addStyle, buildForm } from "../formModule";
import { regularGasLiftLayout } from "../layouts/regular-gas-lift.layout";
import type { WorkbookLayout } from "../layoutTypes";
import { withinSpec } from "../tolerance";

/** Document number of the Regular Gas Lift Support validation form. */
export const GAS_LIFT_REGULAR_DOC_ID = "FRM-VAL-012";

/**
 * FRM-VAL-012 Regular Gas Lift Support Validation, Rev A. Drawn from the workbook "REGULAR GAS LIFT SUPPORT".
 *
 * The workbook only has C27 =AVERAGE(C23:C26); everything below the formula is added by the app:
 *  - D12,14,15,16,23: Pass when C is inside the range read from the OE target in B ("369 +/-2", "195 +20/-10", ...).
 *  - D17,18 (connector style): Pass when C matches B, ignoring case and spaces at the ends. D19 ("N/A"): Pass.
 *  - D28,29: C is a Y/N dropdown; Pass when it equals B. D34-37: C is a Yes/No dropdown; Pass when Yes.
 *  - Rows with no spec (13 compressed length, 24-26 F2-F4, 27 Fa average): B is a field the person types a target into, with or
 *    without a tolerance. The same parser reads it. D stays blank until B and C are both filled, and a row with no result is
 *    left out of the overall result. B13 starts as the workbook's 243, which is a target without a tolerance, so row 13 is
 *    judged once "243 +/-2" (or any range) is typed.
 *  - Result cell F39 (new column) drives the [X] APPROVED / [X] REJECTED ticks. APPROVED WITH DEVIATION stays manual.
 * A blank measurement gives a blank result.
 */
const WORDS = { pass: "Pass", fail: "Fail" };

/** Rows whose spec is on the form as text in column B. */
const SPEC_ROWS = [12, 14, 15, 16, 23];
/** Rows whose spec the person types into column B. Left out of the result until both B and C are filled. */
const TYPED_SPEC_ROWS = [13, 24, 25, 26, 27];
const TEXT_MATCH_ROWS = [17, 18];
const YN_ROWS = [28, 29];
const YES_ROWS = [34, 35, 36, 37];
const NA_ROW = 19;

/** Rows that must have a result before the form has one. Typed-spec rows join only when they have a result. */
const REQUIRED = [...SPEC_ROWS, ...TEXT_MATCH_ROWS, ...YN_ROWS, ...YES_ROWS].sort((a, b) => a - b);
const ALL_RESULT_ROWS = [...REQUIRED, ...TYPED_SPEC_ROWS, NA_ROW].sort((a, b) => a - b);

/** TOLCHECK(spec, measured): "Pass" or "Fail" by the spec's range; blank when the spec or the measurement cannot be judged. */
function tolcheck(args: unknown[]): Value {
  const [spec, measured] = args as [Value, Value];
  if (isError(measured) || isError(spec)) return "";
  const verdict = withinSpec(spec, measured);
  return verdict == null ? "" : verdict ? WORDS.pass : WORDS.fail;
}

const formulas: Record<string, string> = {};
for (const row of [...SPEC_ROWS, ...TYPED_SPEC_ROWS]) formulas[`D${row}`] = `TOLCHECK(B${row},C${row})`;
for (const row of TEXT_MATCH_ROWS) {
  formulas[`D${row}`] = `IF(OR(B${row}="",C${row}=""),"",IF(LOWER(TRIM(C${row}))=LOWER(TRIM(B${row})),"${WORDS.pass}","${WORDS.fail}"))`;
}
formulas[`D${NA_ROW}`] = `IF(UPPER(TRIM(B${NA_ROW}))="N/A","${WORDS.pass}","")`;
for (const row of YN_ROWS) formulas[`D${row}`] = `IF(C${row}="","",IF(LOWER(TRIM(C${row}))=LOWER(TRIM(B${row})),"${WORDS.pass}","${WORDS.fail}"))`;
for (const row of YES_ROWS) formulas[`D${row}`] = `IF(C${row}="","",IF(LOWER(TRIM(C${row}))="yes","${WORDS.pass}","${WORDS.fail}"))`;

const everyRequiredAnswered = `AND(${REQUIRED.map((row) => `D${row}<>""`).join(",")})`;
const anyFailed = `OR(${ALL_RESULT_ROWS.map((row) => `D${row}="${WORDS.fail}"`).join(",")})`;
formulas.F39 = `IF(${everyRequiredAnswered},IF(${anyFailed},"${WORDS.fail}","${WORDS.pass}"),"")`;
// The ticks next to FINAL DISPOSITION follow the result.
formulas.B39 = `IF(F39="${WORDS.pass}","[X] APPROVED","[ ] APPROVED")`;
formulas.C39 = `IF(F39="${WORDS.fail}","[X] REJECTED","[ ] REJECTED")`;

/** Adds the result cell F39 (and its small heading F38) beside FINAL DISPOSITION. */
function withResultCell(layout: WorkbookLayout): WorkbookLayout {
  const base = { b: 1 as const, sz: 11, font: "Aptos Narrow", h: "center" as const, v: "middle" as const };
  const heading = addStyle(layout, { ...base, border: { l: "thin", r: "medium", t: "medium", b: "thin" } });
  const result = addStyle(heading.layout, { ...base, border: { l: "thin", r: "medium", t: "thin", b: "thin" } });
  let next = addCell(result.layout, "F38", { v: "RESULT", s: heading.index }, 14);
  next = addCell(next, "F39", { s: result.index }, 14);
  return next;
}

export const REGULAR_GAS_LIFT_FORM = buildForm({
  type: "regular_gas_lift",
  docId: GAS_LIFT_REGULAR_DOC_ID,
  title: "FRM-VAL-012 REGULAR GAS LIFT SUPPORT VALIDATION DOCUMENT",
  revision: "A",
  passFill: "#00B050",
  words: WORDS,
  layout: regularGasLiftLayout,
  patchLayout: withResultCell,
  docIdCell: "A2",
  revCell: "B2",
  formulas,
  functions: { TOLCHECK: tolcheck },
  // B13 is a plain 243 in the workbook; the person types its tolerance. B24-B27 are empty in the workbook.
  inputs: ["B13"],
  areas: ["B41"],
  defaults: { B13: 243 },
  lists: {
    ...Object.fromEntries(YN_ROWS.map((row) => [`C${row}`, ["Y", "N"]])),
    ...Object.fromEntries(YES_ROWS.map((row) => [`C${row}`, ["Yes", "No"]])),
  },
  ticks: ["D39"],
  // The bands between sections stay empty (the new column F makes them no longer "full width", so say so here).
  locked: ["A4", "A9", "A20", "A31", "A38"],
  signatures: [{ addr: "B40", path: "authorizedSignature", certify: "I certify that this regular gas lift support validation is accurate and I authorize the disposition." }],
  resultCells: ["F39"],
  graph: {
    title: "Spring rate (CTW run)",
    xLabel: "Displacement (mm)",
    yLabel: "Force (N)",
    fields: ["File", "Run", "Notes", "SpringFreeHeight", "ReportedRateEndPoint", "Rate", "SpringContactDisplacement", "ReportedRateStartPoint"],
  },
});
