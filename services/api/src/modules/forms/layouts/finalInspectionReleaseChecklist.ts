import type { FormLayout } from "./types.js";

/**
 * Derived 1:1 from the user-provided "Final Product Inspection List_prior to
 * production.pdf" (Final Inspection & Product Release Checklist — Automotive
 * OEM Production Parts). Lives as a 7th PPAP package document (see
 * PpapDetailPage.tsx) since it's the culmination of a PPAP: releasing
 * production parts against the same drawing/spec/control-plan/PPAP status.
 */
export const finalInspectionReleaseChecklistLayout: FormLayout = {
  formType: "final_inspection_release_checklist",
  title: "FINAL INSPECTION & PRODUCT RELEASE CHECKLIST — AUTOMOTIVE OEM PRODUCTION PARTS",
  sections: [
    {
      number: "1",
      title: "DOCUMENT CONTROL",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "formNo", label: "Form No.:" },
            { kind: "text", name: "revision", label: "Revision:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "date", name: "effectiveDate", label: "Effective Date:" },
            { kind: "text", name: "plantSite", label: "Plant / Site:" },
          ],
        },
      ],
    },
    {
      number: "2",
      title: "PART, ORDER & LOT IDENTIFICATION",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "customerOem", label: "Customer / OEM:" },
            { kind: "text", name: "customerPartNo", label: "Customer Part No.:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "partDescription", label: "Part Description:" },
            { kind: "text", name: "internalPartNo", label: "Internal Part No.:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "drawingRevision", label: "Drawing Revision:" },
            { kind: "text", name: "purchaseOrder", label: "Purchase Order:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "workOrder", label: "Work Order:" },
            { kind: "text", name: "lotBatchHeatNo", label: "Lot / Batch / Heat No.:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "number", name: "quantityProduced", label: "Quantity Produced:" },
            { kind: "number", name: "quantityInspected", label: "Quantity Inspected:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "samplingPlanLevel", label: "Sampling Plan / Level:" },
            { kind: "text", name: "productionDateShift", label: "Production Date / Shift:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "lineMachineTool", label: "Line / Machine / Tool:" },
            { kind: "text", name: "inspector", label: "Inspector:" },
          ],
        },
        { type: "row", fields: [{ kind: "date", name: "inspectionDateTime", label: "Inspection Date / Time:" }] },
      ],
    },
    {
      number: "3",
      title: "RELEASE PREREQUISITES",
      blocks: [
        {
          type: "table",
          name: "releasePrerequisites",
          labelColumnHeader: "No.",
          fixedRowLabels: [
            "1.1 Approved drawing and specification at the required revision are available.",
            "1.2 Approved PPAP / interim approval is valid for this part, process, site, tooling, and material.",
            "1.3 Current control plan, work instructions, inspection standard, and visual aids are available.",
            "1.4 All engineering changes, deviations, concessions, and temporary approvals are current and within scope.",
            "1.5 All required in-process inspections, SPC records, and operator sign-offs are complete and acceptable.",
            "1.6 Required first-off / first article and last-off / last article approvals are complete.",
            "1.7 Required material, plating, coating, heat-treatment, laboratory, or certificate-of-analysis records are present and accepted.",
            "1.8 All inspection and test equipment used is identified, within calibration, suitable for tolerance, and in acceptable condition.",
            "1.9 Applicable customer-specific requirements and special release instructions have been reviewed.",
          ],
          columns: [
            { key: "result", label: "Pass / Fail / N/A", kind: "select", options: ["Pass", "Fail", "N/A"] },
            { key: "evidence", label: "Evidence / Remarks", kind: "textarea" },
          ],
        },
      ],
    },
    {
      number: "4",
      title: "PRODUCT VERIFICATION",
      blocks: [
        {
          type: "table",
          name: "productVerification",
          labelColumnHeader: "No.",
          fixedRowLabels: [
            "2.1 Part identity, geometry, and configuration match the part number and approved design record.",
            "2.2 All safety, regulatory, critical, significant, and other special characteristics were verified at the specified frequency.",
            "2.3 Dimensional results meet specification; actual readings and measurement record reference are documented.",
            "2.4 Material, hardness, performance, functional, leak, torque, electrical, or other required test results meet acceptance criteria.",
            "2.5 Surface finish, coating, plating, color, gloss, texture, and cleanliness meet requirements where applicable.",
            "2.6 Visual condition is acceptable: no cracks, burrs, sharp edges, contamination, corrosion, dents, scratches, flash, distortion, or other prohibited defects.",
            "2.7 Assembly is complete; required components, fasteners, seals, clips, inserts, and orientation are correct.",
            "2.8 Identification and traceability markings are present, legible, durable, correct, and linked to the production lot.",
            "2.9 Error-proofing verification and required challenge / master sample checks are complete and acceptable.",
            "2.10 No mixed parts, suspect material, rework, unauthorized repair, or nonconforming product is present in the release quantity.",
          ],
          columns: [
            { key: "result", label: "Pass / Fail / N/A", kind: "select", options: ["Pass", "Fail", "N/A"] },
            { key: "evidence", label: "Evidence / Results", kind: "textarea" },
          ],
        },
        {
          type: "table",
          name: "keyCharacteristicResults",
          addableRows: true,
          minRows: 5,
          columns: [
            { key: "characteristic", label: "Characteristic / Symbol", kind: "text" },
            { key: "specTolerance", label: "Specification & Tolerance", kind: "text" },
            { key: "actualResult", label: "Actual Result(s)", kind: "text" },
            { key: "gageId", label: "Gage ID", kind: "text" },
            { key: "status", label: "Status", kind: "select", options: ["Pass", "Fail"] },
          ],
        },
      ],
    },
    {
      number: "5",
      title: "PACKAGING, LABELING & SHIPPING VERIFICATION",
      blocks: [
        {
          type: "table",
          name: "packagingVerification",
          labelColumnHeader: "No.",
          fixedRowLabels: [
            "3.1 Approved customer packaging specification and latest pack instruction are available and followed.",
            "3.2 Container, dunnage, protection, corrosion prevention, cleanliness, closure, and pallet condition are acceptable.",
            "3.3 Standard pack quantity, total quantity, container count, and unit of measure are correct.",
            "3.4 Customer label format, part number, revision, quantity, lot/date code, supplier code, serial data, and barcode content are correct and scannable.",
            "3.5 Required hazardous-material, regulatory, country-of-origin, special-handling, and returnable-container markings are correct.",
            "3.6 Packing slip, advance shipping notice data, certificates, and other required shipment documents agree with the product and purchase order.",
            "3.7 Shipment is protected from damage, contamination, deterioration, and mixed-lot / mixed-part risk during storage and transport.",
          ],
          columns: [
            { key: "result", label: "Pass / Fail / N/A", kind: "select", options: ["Pass", "Fail", "N/A"] },
            { key: "evidence", label: "Evidence / Remarks", kind: "textarea" },
          ],
        },
      ],
    },
    {
      number: "6",
      title: "NONCONFORMANCE & CONTAINMENT",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "select", name: "anyRequirementFailed", label: "Any Requirement Failed?", options: ["No", "Yes — Stop release and complete this section"] },
            { kind: "number", name: "affectedQuantity", label: "Affected Quantity:" },
          ],
        },
        { type: "row", fields: [{ kind: "text", name: "holdQuarantineLocation", label: "Hold / Quarantine Location:" }] },
        { type: "row", fields: [{ kind: "text", name: "ncrDeviationConcessionNo", label: "NCR / Deviation / Concession No.:" }] },
        {
          type: "table",
          name: "containmentPerformed",
          fixedRowLabels: ["Containment Performed"],
          columns: [
            {
              key: "value",
              label: "Containment Performed",
              kind: "checkboxGroup",
              options: ["Segregated", "100% Sorted", "Reinspected", "Customer Notified", "Other"],
            },
          ],
        },
        {
          type: "table",
          name: "disposition",
          fixedRowLabels: ["Disposition"],
          columns: [
            {
              key: "value",
              label: "Disposition",
              kind: "checkboxGroup",
              options: ["Rework", "Scrap", "Return", "Use-As-Is by Written Approval", "Other"],
            },
          ],
        },
        { type: "textarea", name: "descriptionEvidence", label: "Description / Evidence:" },
      ],
    },
    {
      number: "7",
      title: "FINAL RELEASE AUTHORIZATION",
      blocks: [
        {
          type: "table",
          name: "finalDecision",
          fixedRowLabels: ["Final Decision"],
          columns: [
            {
              key: "value",
              label: "Final Decision",
              kind: "checkboxGroup",
              options: ["RELEASE", "HOLD", "REJECT", "CONDITIONAL RELEASE — Written Authorization Attached"],
            },
          ],
        },
        { type: "row", fields: [{ kind: "number", name: "quantityReleased", label: "Quantity Released:" }] },
        {
          type: "textarea",
          name: "releaseStatement",
          label: "Release Statement:",
          hint:
            "I certify that the recorded checks were completed using current requirements and suitable inspection equipment, " +
            "and that the released quantity conforms to applicable specifications and customer requirements.",
        },
        {
          type: "table",
          name: "authorizationSignoffs",
          labelColumnHeader: "Role",
          fixedRowLabels: ["Final Inspector", "Quality Approval", "Additional Approval (if required)"],
          columns: [
            { key: "name", label: "Name", kind: "text" },
            { key: "signature", label: "Signature", kind: "text" },
            { key: "date", label: "Date / Time", kind: "date" },
          ],
        },
      ],
    },
  ],
};
