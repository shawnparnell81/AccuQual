import { DEFAULT_INSPECTOR } from "../../validationReport";
import { buildForm } from "../formModule";
import { electricLiftLayout } from "../layouts/electric-lift.layout";

/**
 * FRM-VAL-004 Electric Lift Support Validation Document, Rev C. Drawn from FRM-VAL-004-Electric-Lift-Support-RevC.xlsx.
 *
 * Everything is the workbook's own formula, ported as written, except:
 *  - I12, I26, I27, I28 and I38 (workbook: "both the OE and Gaci values were entered") also require the Gaci sample (H) to sit
 *    inside E..F when the drawing value (B) and both tolerances (C and D) are filled in. E and F are the typed min and max; when
 *    one is left blank it is taken from the form's own B-C / B+D (no tolerance is invented). With B, C and D not all filled the
 *    workbook's "value entered" check stays.
 *  - G2 and H2 (the PASS and FAIL boxes under the header) are locked; the workbook colors them from B53.
 *  - "[ ] APPROVED WITH DEVIATION" (D53) is a manual tick.
 *
 * Open, kept as the workbook has it:
 *  - I44 (spring rate: max of B44, G44, H44 within 10% of the min) is NOT counted in the B53 rollup. B53 counts 25 Passes:
 *    I12:I22 + I26:I29 + I33:I34 + I38:I43 + D48:D49. Pending Shawn: should the spring-rate row count?
 *  - "OE vs drawing": B is the drawing value and G is the OE measurement, but the Pass/Fail rows with a min/max band (I14-I22,
 *    I40-I42) test G and H against drawing B-C..B+D; the OE sample is held to the drawing, not just to itself. Pending Shawn.
 *  - B51 "Ready For Gaci Sample" counts 23 OE (G) entries, so it ignores G44 and row 29's pinout.
 */
export const ELECTRIC_CERTIFY = "I certify that this electric lift support validation is accurate and I authorize the disposition.";

/** Rows where the workbook only checks that the OE and Gaci values were typed in. */
export const BAND_ROWS = [12, 26, 27, 28, 38];

const formulas: Record<string, string> = {};
for (const row of BAND_ROWS) {
  const min = `IF(E${row}="",B${row}-C${row},E${row})`;
  const max = `IF(F${row}="",B${row}+D${row},F${row})`;
  const bandFilled = `AND(B${row}<>"",C${row}<>"",D${row}<>"")`;
  formulas[`I${row}`] = `IF(AND(G${row}<>"", H${row}<>""), IF(${bandFilled}, IF(AND(H${row}>=${min}, H${row}<=${max}), "Pass", "Fail"), "Pass"), "Fail")`;
}

export const ELECTRIC_LIFT_FORM = buildForm({
  type: "electric_lift",
  docId: "FRM-VAL-004",
  title: "FRM-VAL-004 ELECTRIC LIFT SUPPORT VALIDATION DOCUMENT",
  revision: "C",
  passFill: "#00B050",
  words: { pass: "APPROVED", fail: "Fail" },
  layout: electricLiftLayout,
  docIdCell: "A2",
  revCell: "B2",
  formulas,
  locked: ["G2", "H2"],
  ticks: ["D53"],
  defaults: { B8: DEFAULT_INSPECTOR },
  signatures: [{ addr: "B54", path: "authorizedSignature", certify: ELECTRIC_CERTIFY }],
  resultCells: ["B53"],
  graph: {
    title: "Force vs displacement",
    xLabel: "Displacement (mm)",
    yLabel: "Force (N)",
    fields: ["File", "Run", "Notes", "SpringFreeHeight", "ReportedRateEndPoint", "Rate", "SpringContactDisplacement", "ReportedRateStartPoint"],
  },
});
