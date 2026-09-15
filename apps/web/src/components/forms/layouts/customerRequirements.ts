import type { FormLayout } from "./types";

/**
 * The Customer Onboarding module's 5 "requirements" sub-sections
 * (Qualification, Requirements, Quality, Logistics, Contract) consolidated
 * into ONE real form in this engine — entityId = the customers.ts row's own
 * id — rather than 5 separate SQL tables. See customers.ts's own schema
 * comment for why. Opened via OpenFormButton from CustomerDetailPage, same
 * pattern as ChangeDetailPage's single "PCN Document" button.
 */
export const customerRequirementsLayout: FormLayout = {
  formType: "customer_requirements",
  title: "CUSTOMER REQUIREMENTS",
  sections: [
    {
      number: "1",
      title: "QUALIFICATION",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "dunsNumber", label: "D-U-N-S Number:" },
            { kind: "text", name: "taxId", label: "Tax ID / EIN:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "annualRevenue", label: "Estimated Annual Revenue:" },
            { kind: "text", name: "employeeCount", label: "Employee Count:" },
          ],
        },
        {
          type: "row",
          fields: [{ kind: "text", name: "reference1", label: "Trade Reference 1:" }],
        },
        { type: "textarea", name: "qualificationNotes", label: "Qualification Notes:", hint: "Financial standing, references checked, prior relationship, etc." },
      ],
    },
    {
      number: "2",
      title: "REQUIREMENTS",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "contactTitle", label: "Primary Contact Title:" },
            { kind: "text", name: "contactDepartment", label: "Primary Contact Department:" },
          ],
        },
        { type: "textarea", name: "productServiceRequirements", label: "Product / Service Requirements:", hint: "What the customer needs produced/supplied" },
        { type: "textarea", name: "volumeForecast", label: "Volume / Forecast Expectations:" },
        { type: "yesno", name: "ndaRequired", label: "Is an NDA required before sharing technical details?" },
        { type: "yesno", name: "ltaExpected", label: "Is a Long-Term Agreement (LTA) expected?" },
      ],
    },
    {
      number: "3",
      title: "QUALITY",
      blocks: [
        {
          type: "table",
          name: "requiredCertifications",
          addableRows: true,
          minRows: 3,
          columns: [
            { key: "certification", label: "Certification / Standard", kind: "checkboxGroup", options: ["ISO 9001", "IATF 16949", "AS9100", "ISO 13485", "ISO 14001", "Other"] },
            { key: "reference", label: "Reference / Version", kind: "text" },
            { key: "onFile", label: "On File", kind: "checkboxGroup", options: ["Yes", "No"] },
          ],
        },
        { type: "yesno", name: "ppapRequired", label: "Is PPAP required for this customer?" },
        { type: "yesno", name: "csrOnFile", label: "Are Customer-Specific Requirements (CSR) on file?" },
        { type: "textarea", name: "qualityRequirementsNotes", label: "Quality Requirements Notes:" },
      ],
    },
    {
      number: "4",
      title: "LOGISTICS",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "incoterms", label: "Incoterms:" },
            { kind: "text", name: "preferredCarrier", label: "Preferred Carrier:" },
          ],
        },
        { type: "textarea", name: "packagingRequirements", label: "Packaging / Labeling Requirements:" },
        { type: "yesno", name: "ediRequired", label: "Is EDI (electronic data interchange) required?" },
        { type: "textarea", name: "logisticsNotes", label: "Logistics Notes:" },
      ],
    },
    {
      number: "5",
      title: "CONTRACT",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "select", name: "contractType", label: "Contract Type:", options: ["Purchase Order Terms", "Master Service Agreement", "Long-Term Agreement", "Pricing Agreement", "Other"] },
            { kind: "text", name: "paymentTerms", label: "Payment Terms:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "date", name: "effectiveDate", label: "Effective Date:" },
            { kind: "date", name: "expirationDate", label: "Expiration Date:" },
          ],
        },
        { type: "yesno", name: "legalReviewCompleted", label: "Has legal review been completed?" },
        { type: "textarea", name: "contractNotes", label: "Contract Notes:" },
        {
          type: "table",
          name: "signOff",
          labelColumnHeader: "Role",
          fixedRowLabels: ["Sales Representative", "Quality Manager", "Finance / Contracts"],
          columns: [
            { key: "name", label: "Name", kind: "text" },
            { key: "date", label: "Date", kind: "date" },
            { key: "approved", label: "Approved", kind: "checkboxGroup", options: ["Yes", "No"] },
          ],
        },
      ],
    },
  ],
};
