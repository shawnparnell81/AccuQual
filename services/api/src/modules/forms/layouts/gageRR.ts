import type { FormLayout } from "./types.js";

/**
 * Export-only layout for formType "gage_rr" — the on-screen editing
 * experience is a bespoke component (apps/web's customForms/GageRRForm.tsx)
 * because the study's calculations are whole-grid, not row-by-row; that
 * component writes its final computed values into `data` on every change,
 * and this plain layout is what prints them on PDF export (this codepath
 * never runs the React component). Deliberately NOT mirrored into apps/web's
 * layouts/ — see customForms/index.ts's comment for why.
 */
export const gageRRLayout: FormLayout = {
  formType: "gage_rr",
  title: "GAGE R&R (AVERAGE AND RANGE METHOD)",
  sections: [
    {
      number: "1",
      title: "STUDY HEADER",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "deviceNumber", label: "Device Number:" },
            { kind: "text", name: "partNumber", label: "Part Number:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "characteristic", label: "Characteristic:" },
            { kind: "text", name: "tolerance", label: "Tolerance:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "operatorAName", label: "Operator A Name:" },
            { kind: "text", name: "operatorBName", label: "Operator B Name:" },
          ],
        },
        { type: "row", fields: [{ kind: "date", name: "studyDate", label: "Study Date:" }] },
      ],
    },
    {
      // Row blocks reading the same flat field names GageRRForm.tsx writes
      // into `data` (rBar, xBarDiff, ...) — not a table, since that data
      // isn't shaped as an array of rows.
      number: "2",
      title: "CALCULATION RESULTS",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "rBar", label: "R̄ (Rśr):" },
            { kind: "text", name: "xBarDiff", label: "X̄ Diff:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "uclR", label: "UCL_R:" },
            { kind: "text", name: "ev", label: "EV (Equipment Variation):" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "evPctTol", label: "%EV & Tol:" },
            { kind: "text", name: "av", label: "AV (Appraiser Variation):" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "avPctTol", label: "%AV & Tol:" },
            { kind: "text", name: "pv", label: "PV (Part Variation):" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "pvPctTol", label: "%PV & Tol:" },
            { kind: "text", name: "grr", label: "GRR:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "grrPctTol", label: "%GRR & Tol:" },
            { kind: "text", name: "systemEvaluation", label: "System Evaluation:" },
          ],
        },
      ],
    },
    {
      number: "3",
      title: "APPROVAL",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "date", name: "approvalDate", label: "Date:" },
            { kind: "text", name: "approvalSignature", label: "Signature:" },
          ],
        },
      ],
    },
  ],
};
