import type { FormLayout } from "./types.js";

/** Derived 1:1 from the user-provided "Product_Process_Change_Notice.pdf" (PCN). */
export const pcnLayout: FormLayout = {
  formType: "pcn",
  title: "PRODUCT / PROCESS CHANGE NOTICE (PCN)",
  sections: [
    {
      number: "1",
      title: "GENERAL INFORMATION",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "pcnNumber", label: "PCN Number:" },
            { kind: "date", name: "initiationDate", label: "Initiation Date:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "customerName", label: "Customer Name:" },
            { kind: "text", name: "requestedBy", label: "Requested By:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "supplierName", label: "Supplier Name:" },
            { kind: "text", name: "contactEmail", label: "Contact Email:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "plantLocation", label: "Plant Location:" },
            { kind: "date", name: "effectivityDate", label: "Effectivity Date:" },
          ],
        },
      ],
    },
    {
      number: "2",
      title: "CHANGE CLASSIFICATION & TYPE",
      blocks: [
        {
          type: "table",
          name: "changeLevel",
          fixedRowLabels: ["Change Level"],
          columns: [{ key: "level", label: "Change Level", kind: "checkboxGroup", options: ["Major Change (customer approval required)", "Minor Change (information only)"] }],
        },
        {
          type: "table",
          name: "changeCategory",
          fixedRowLabels: ["Change Category"],
          columns: [
            {
              key: "category",
              label: "Change Category",
              kind: "checkboxGroup",
              options: ["Material", "Design / Geometry", "Manufacturing Process", "Tooling", "Software / Firmware", "Equipment", "Testing / Inspection"],
            },
          ],
        },
      ],
    },
    {
      number: "3",
      title: "AFFECTED ITEMS",
      blocks: [
        {
          type: "table",
          name: "affectedItems",
          addableRows: true,
          minRows: 3,
          columns: [
            { key: "partProcessNumber", label: "Part / Process #", kind: "text" },
            { key: "description", label: "Description", kind: "textarea" },
            { key: "currentRev", label: "Current Rev", kind: "text" },
            { key: "newRev", label: "New Rev", kind: "text" },
            { key: "inventoryScrapRework", label: "Inventory Scrap / Rework", kind: "textarea" },
            { key: "traceabilityDateLotCode", label: "Traceability Date / Lot Code", kind: "text" },
          ],
        },
      ],
    },
    {
      number: "4",
      title: "DETAILED DESCRIPTION OF CHANGE",
      blocks: [
        { type: "textarea", name: "currentCondition", label: "Current Condition (Before Change):" },
        { type: "textarea", name: "proposedCondition", label: "Proposed Condition (After Change):" },
        { type: "textarea", name: "reasonForChange", label: "Reason for Change / Justification:" },
      ],
    },
    {
      number: "5",
      title: "RISK ASSESSMENT & VALIDATION PLAN",
      blocks: [
        {
          type: "table",
          name: "validationPlan",
          addableRows: true,
          minRows: 3,
          columns: [
            { key: "validationActivity", label: "Validation Test / Evaluation Activity", kind: "textarea" },
            { key: "acceptanceCriteriaStatus", label: "Acceptance Criteria / Status", kind: "textarea" },
            { key: "targetCompDate", label: "Target Comp. Date", kind: "date" },
          ],
        },
      ],
    },
    {
      number: "6",
      title: "REVIEW & AUTHORIZATION SIGN-OFFS",
      blocks: [
        {
          type: "table",
          name: "signoffs",
          labelColumnHeader: "Role / Department",
          fixedRowLabels: ["Change Initiator", "Quality Engineering", "Operations / Plant Mgmt", "Customer Representative (if req.)"],
          columns: [
            { key: "authorizedSignature", label: "Authorized Signature", kind: "text" },
            { key: "decisionStatus", label: "Decision / Status", kind: "checkboxGroup", options: ["Approved", "Rejected"] },
            { key: "date", label: "Date", kind: "date" },
          ],
        },
      ],
    },
  ],
};
