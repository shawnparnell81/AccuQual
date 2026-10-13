import { DEFAULT_INSPECTOR } from "../../validationReport";
import { buildForm } from "../formModule";
import { fuelInjectorLayout } from "../layouts/fuel-injector.layout";

/**
 * FRM-VAL-008 Fuel Injector Validation Document, Rev B. Drawn from FRM-VAL-008-Fuel-Injector-RevB.xlsx.
 *
 * Every workbook formula is used as written: Min/Max (B±D), the NA rule (a nominal of "NA" passes), the Y/N checks, the
 * packaging tolerance (10% of nominal), the dynamic flow block (E = volume / 6000 or 3000, TREND of E against the PW
 * setting, SLOPE, the 0.7739 fluid correction on the static flow, and the 5% linear deviation that a Side Feed/Spider
 * injector skips) and the section 6 rollups (J2 and B56).
 *
 * Differences from the workbook:
 *  - the section 7 "Furthur Review" Pass/Fail (B63) is a manual Pass/Fail dropdown (the workbook left it a blank box).
 *  - the two signature rows (B58 authorized, B65 further review) are signature stamps, as the app already had them.
 *  - H34 (Side Feed/Spider) starts unticked: the workbook file had it ticked, which would skip the linear deviation on a
 *    blank Top Feed form. The app has always started it unticked.
 */
export const FUEL_INJECTOR_FORM = buildForm({
  type: "fuel_injector",
  docId: "FRM-VAL-008",
  title: "FRM-VAL-008 FUEL INJECTOR VALIDATION DOCUMENT",
  revision: "B",
  passFill: "#00B050",
  words: { pass: "Pass", fail: "Fail" },
  layout: fuelInjectorLayout,
  docIdCell: "A2",
  revCell: "B2",
  lists: {
    B63: ["Pass", "Fail"],
  },
  signatures: [
    { addr: "B58", path: "authorizedSignature", certify: "I certify that this fuel injector validation is accurate and I authorize the disposition." },
    { addr: "B65", path: "furtherSignature", certify: "I certify that the further review of this fuel injector is accurate and I authorize the later disposition." },
  ],
  defaults: { B8: DEFAULT_INSPECTOR, D34: false, H34: false },
  resultCells: ["J2", "B56"],
});
