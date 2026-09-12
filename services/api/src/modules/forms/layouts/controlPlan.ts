import type { FormLayout } from "./types.js";

/** Derived 1:1 from the user-provided "control_plan_template.pdf". */
export const controlPlanLayout: FormLayout = {
  formType: "control_plan",
  title: "CONTROL PLAN",
  sections: [
    {
      number: "1",
      title: "CONTROL PLAN HEADER",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "controlPlanNumber", label: "Control Plan Number:" },
            { kind: "text", name: "partNumberChangeLevel", label: "Part Number / Latest Change Level:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "partNameDescription", label: "Part Name / Description:" },
            { kind: "text", name: "organizationPlant", label: "Organization / Plant:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "supplierSupplierCode", label: "Supplier / Supplier Code:" },
            { kind: "text", name: "keyContactPhone", label: "Key Contact / Phone:" },
          ],
        },
        { type: "textarea", name: "coreTeam", label: "Core Team:" },
        {
          type: "row",
          fields: [
            { kind: "text", name: "customerEngineeringApproval", label: "Customer Engineering Approval / Date:" },
            { kind: "text", name: "customerQualityApproval", label: "Customer Quality Approval / Date:" },
          ],
        },
        { type: "row", fields: [{ kind: "text", name: "otherApproval", label: "Other Approval / Date:" }] },
      ],
    },
    {
      number: "2",
      title: "PROCESS / CHARACTERISTIC / CONTROL METHOD",
      blocks: [
        {
          type: "table",
          name: "controlItems",
          addableRows: true,
          minRows: 5,
          columns: [
            { key: "partProcessNum", label: "Part / Proc Num", kind: "text" },
            { key: "processName", label: "Process Name / Operation Description", kind: "textarea" },
            { key: "machineDeviceJigTools", label: "Machine, Device, Jig, Tools for Mfg", kind: "text" },
            { key: "characteristicNo", label: "Characteristic No.", kind: "text" },
            { key: "characteristicProduct", label: "Characteristic — Product", kind: "textarea" },
            { key: "characteristicProcess", label: "Characteristic — Process", kind: "textarea" },
            { key: "specialCharClass", label: "Special Char Class", kind: "text" },
            { key: "specTolerance", label: "Product / Process Specification / Tolerance", kind: "textarea" },
            { key: "evaluationTechnique", label: "Evaluation / Measurement Technique", kind: "textarea" },
            { key: "sampleSize", label: "Sample Size", kind: "text" },
            { key: "sampleFreq", label: "Sample Freq", kind: "text" },
            { key: "reactionPlan", label: "Reaction Plan", kind: "textarea" },
          ],
        },
      ],
    },
  ],
};
