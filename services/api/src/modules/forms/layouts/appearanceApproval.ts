import type { FormLayout } from "./types.js";

/** Derived 1:1 from the user-provided Appearance_Approval_Report_New.pdf (AAR). */
export const appearanceApprovalLayout: FormLayout = {
  formType: "appearance_approval",
  title: "APPEARANCE APPROVAL REPORT (AAR)",
  sections: [
    {
      number: "1",
      title: "PART & SUBMISSION INFORMATION",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "partNumber", label: "Part Number:" },
            { kind: "text", name: "drawingNumber", label: "Drawing Number:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "partName", label: "Part Name:" },
            { kind: "text", name: "engineeringChangeLevel", label: "Engineering Change Level / Date:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "application", label: "Application (Vehicle / Product):" },
            { kind: "text", name: "buyerCode", label: "Buyer Code / Name:" },
          ],
        },
      ],
    },
    {
      number: "2",
      title: "MANUFACTURING & REASON FOR SUBMISSION",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "organizationName", label: "Organization Name:" },
            { kind: "text", name: "manufacturingLocation", label: "Manufacturing Location:" },
          ],
        },
        { type: "row", fields: [{ kind: "text", name: "supplierVendorCode", label: "Supplier / Vendor Code:" }] },
        {
          type: "table",
          name: "reasonForSubmission",
          fixedRowLabels: ["Reason"],
          columns: [
            {
              key: "reason",
              label: "Reason for Submission",
              kind: "checkboxGroup",
              options: ["Part Submission Warrant (PSW)", "Engineering Change", "First Production Shipment"],
            },
          ],
        },
      ],
    },
    {
      number: "3",
      title: "PRE-TEXTURE / SURFACE EVALUATION (BEFORE TOOLING OPERATIONS)",
      blocks: [
        {
          type: "table",
          name: "surfaceEvaluation",
          labelColumnHeader: "Surface Characteristic",
          fixedRowLabels: ["Graining / Structure", "Surface Finish / Tooling Finish", "Assembly Gap / Flushness"],
          columns: [{ key: "referenceNormSpec", label: "Reference Norm / Spec", kind: "text" }],
        },
      ],
    },
    {
      number: "4",
      title: "INSTRUMENTAL COLOR & GLOSS EVALUATION",
      blocks: [
        {
          type: "table",
          name: "colorGlossEvaluation",
          addableRows: true,
          minRows: 2,
          columns: [
            { key: "colorMatNo", label: "Color / Mat. No.", kind: "text" },
            { key: "masterDate", label: "Master Date", kind: "date" },
            { key: "typeSource", label: "Type Source", kind: "text" },
            { key: "dL", label: "DL*", kind: "text" },
            { key: "dA", label: "Da*", kind: "text" },
            { key: "dB", label: "Db*", kind: "text" },
            { key: "dE", label: "DE*", kind: "text" },
            { key: "cmc", label: "CMC", kind: "text" },
            { key: "glossMeasured", label: "Gloss (Measured)", kind: "text" },
          ],
        },
      ],
    },
    {
      number: "5",
      title: "VISUAL ASSESSMENT (COMPARED TO MASTER SAMPLE UNDER STANDARD LIGHT)",
      blocks: [
        {
          type: "table",
          name: "visualAssessment",
          fixedRowLabels: ["Assessment"],
          columns: [
            { key: "hue", label: "Hue", kind: "checkboxGroup", options: ["Red", "Yellow", "Green", "Blue"] },
            { key: "value", label: "Value", kind: "checkboxGroup", options: ["Light", "Dark"] },
            { key: "chroma", label: "Chroma", kind: "checkboxGroup", options: ["Gray", "Clean"] },
            { key: "glossLevel", label: "Gloss Level", kind: "checkboxGroup", options: ["High", "Low"] },
            { key: "metallicBrilliance", label: "Metallic Brilliance", kind: "checkboxGroup", options: ["High", "Low"] },
          ],
        },
        {
          type: "table",
          name: "sampleEvaluationResults",
          addableRows: true,
          minRows: 3,
          columns: [
            { key: "result", label: "Sample Evaluation Result", kind: "textarea" },
            { key: "disposition", label: "Disposition", kind: "checkboxGroup", options: ["OK", "NOT OK"] },
          ],
        },
      ],
    },
    {
      number: "6",
      title: "FINAL DISPOSITION & COMMENTS",
      blocks: [
        {
          type: "table",
          name: "finalStatus",
          fixedRowLabels: ["Final Status"],
          columns: [{ key: "status", label: "Status", kind: "checkboxGroup", options: ["Approved", "Rejected", "Interim Approved"] }],
        },
        { type: "textarea", name: "commentsCorrectiveActions", label: "Comments / Corrective Actions:" },
        {
          type: "table",
          name: "signoffs",
          fixedRowLabels: ["Organization Authorized Representative", "Customer Representative Approval"],
          columns: [
            { key: "signature", label: "Signature", kind: "text" },
            { key: "date", label: "Date", kind: "date" },
          ],
        },
      ],
    },
  ],
};
