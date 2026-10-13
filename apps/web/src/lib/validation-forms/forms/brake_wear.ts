import { DEFAULT_INSPECTOR } from "../../validationReport";
import { BRAKE_WEAR_CERTIFY, BRAKE_WEAR_FURTHER_CERTIFY } from "../../partInspection";
import { buildForm } from "../formModule";
import { brakeWearLayout } from "../layouts/brake-wear.layout";

/**
 * FRM-VAL-009 Brake Wear Sensor Validation Document, Rev A. Drawn from FRM-VAL-009-Brake-Wear-Sensor-RevA.xlsx.
 * (The workbook tab is named FRM-VAL-008 by mistake; the form is FRM-VAL-009.)
 *
 * Every formula is the workbook's own, ported as written: Min/Max = Nominal -/+ Tolerance, the OR(B="NA") rule, the
 * E<=G<=F band, the Y/N checks, and the AND rollup over H12:H18 and H22:H24 in B27 and J2.
 *
 * Difference from the workbook:
 *  - the section 5 Further Review Pass/Fail (B34), a free cell in the workbook, is a manual Pass/Fail dropdown.
 *
 * Kept as written (open question): row 16 "Electrical Sensor Length" has nominal 0, tolerance 0 and Min/Max 0, so only a
 * sample of exactly 0 passes. FINAL DISPOSITION ticks stay manual, as in the form before.
 */
export const BRAKE_WEAR_FORM = buildForm({
  type: "brake_wear",
  docId: "FRM-VAL-009",
  title: "FRM-VAL-009 BRAKE WEAR SENSOR VALIDATION DOCUMENT",
  revision: "A",
  passFill: "#00B050",
  words: { pass: "Pass", fail: "Fail" },
  layout: brakeWearLayout,
  docIdCell: "A2",
  revCell: "B2",
  lists: { B34: ["Pass", "Fail"] },
  defaults: { B8: DEFAULT_INSPECTOR },
  signatures: [
    { addr: "B29", path: "authorizedSignature", certify: BRAKE_WEAR_CERTIFY },
    { addr: "B36", path: "furtherSignature", certify: BRAKE_WEAR_FURTHER_CERTIFY },
  ],
  resultCells: ["J2", "B27"],
});
