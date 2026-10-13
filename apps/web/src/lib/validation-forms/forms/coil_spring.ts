import { COIL_CERTIFY } from "../../batch3Reports";
import { DEFAULT_INSPECTOR } from "../../validationReport";
import { buildForm } from "../formModule";
import { coilSpringLayout } from "../layouts/coil-spring.layout";
import type { Words } from "../rules";

/**
 * FRM-VAL-006 Coil Spring Validation Document, Rev A. Drawn from FRM-VAL-006-Coil-Spring-RevA.xlsx.
 *
 * Ported as written: the AVERAGE and RESULT formulas (H and I columns), the spring-rate min/max (C23, D23), the max design
 * force B30, the Wahl max shear stress G31 (LET formula) and its <= 1200 check (C32, E32, G32).
 *
 * Differences from the workbook:
 *  - G33 (Visual / Paint Inspection) gets a PASS/FAIL dropdown; C33 and E33 tick "X" from it, the way C32 and E32 do for G32.
 *  - I14 and I15 (coil type match) returned the text "FALSE" on a mismatch; they now return "FAIL".
 *  - The static "[ X ] APPROVED" in B35 is now driven by the overall result (A4, a result cell added in the empty band under
 *    the purpose line): APPROVED when it is PASS, REJECTED (D35) when it is FAIL. APPROVED WITH DEVIATION (F35) stays a manual
 *    tick. The leading space in F35's text is dropped so the tick shows.
 *  - The overall result rolls up I12:I19, I23:I26, G32 and G33. A row with a blank nominal is skipped. It stays blank until
 *    every counted row has a result, then FAIL if any row failed, otherwise PASS.
 */
export const COIL_WORDS: Words = { pass: "PASS", fail: "FAIL" };

/** Rows with a RESULT in column I (row 25, Installed Load, has none). */
const RESULT_ROWS = [12, 13, 14, 15, 16, 17, 18, 19, 23, 24, 26];

const answeredOrSkipped = RESULT_ROWS.map((row) => `OR(B${row}="",I${row}<>"")`);
const failed = [...RESULT_ROWS.map((row) => `I${row}="FAIL"`), 'G32="FAIL"', 'G33="FAIL"'];

const coilType = (row: number) => `IF(E${row}="","",IF(AND(B${row}=E${row},OR(B${row}=F${row},F${row}=""),OR(B${row}=G${row},G${row}="")),"PASS","FAIL"))`;

export const COIL_SPRING_FORM = buildForm({
  type: "coil_spring",
  docId: "FRM-VAL-006",
  title: "FRM-VAL-006 COIL SPRING VALIDATION DOCUMENT",
  revision: "A",
  passFill: "#00B050",
  words: COIL_WORDS,
  layout: coilSpringLayout,
  docIdCell: "A2",
  revCell: "B2",
  formulas: {
    I14: coilType(14),
    I15: coilType(15),
    C33: 'IF(G33="","",IF(G33="PASS","X",""))',
    E33: 'IF(G33="","",IF(G33="FAIL","X",""))',
    A4: `IF(AND(${answeredOrSkipped.join(",")},G32<>"",G33<>""),IF(OR(${failed.join(",")}),"FAIL","PASS"),"")`,
    B35: 'IF(A4="PASS","[ X ] APPROVED","[ ] APPROVED")',
    D35: 'IF(A4="FAIL","[ X ] REJECTED","[ ] REJECTED")',
  },
  lists: { G33: [COIL_WORDS.pass, COIL_WORDS.fail] },
  ticks: ["F35"],
  patchLayout: (layout) => ({ ...layout, cells: { ...layout.cells, F35: { ...layout.cells.F35!, v: "[ ] APPROVED WITH DEVIATION" } } }),
  signatures: [{ addr: "B36", path: "authorizedSignature", certify: COIL_CERTIFY }],
  defaults: { B8: DEFAULT_INSPECTOR, B14: "Tangential", E14: "Tangential", B15: "Pigtail", E15: "Pigtail" },
  resultCells: ["A4"],
});
