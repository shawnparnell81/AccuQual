import type { FormLayout } from "./types";

/**
 * Derived 1:1 from the user-provided fmea.pdf (Potential Failure Mode and
 * Effects Analysis — Process FMEA). The source template spans two PDF pages
 * only because its analysis table is too wide to print on one sheet — R.P.N.
 * (Risk Priority Number) wraps onto page 2. Here it's one continuous table
 * with the R.P.N. columns computed automatically (Severity x Occurrence x
 * Detection), not typed in, per the AIAG FMEA method.
 */
export const fmeaLayout: FormLayout = {
  formType: "fmea",
  title: "POTENTIAL FAILURE MODE AND EFFECTS ANALYSIS (PROCESS FMEA)",
  sections: [
    {
      number: "1",
      title: "FMEA HEADER",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "fmeaNumber", label: "FMEA Number:" },
            { kind: "date", name: "fmeaDate", label: "FMEA Date:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "item", label: "Item (Name / Number):" },
            { kind: "text", name: "process", label: "Process:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "responsibility", label: "Responsibility:" },
            { kind: "text", name: "preparedBy", label: "Prepared By:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "modelYears", label: "Model Years / Programs:" },
            { kind: "date", name: "keyDate", label: "Key Date:" },
          ],
        },
        {
          type: "textarea",
          name: "coreTeam",
          label: "Core Team:",
          hint: "Names of the cross-functional team members conducting this analysis",
        },
      ],
    },
    {
      number: "2",
      title: "FAILURE MODE & EFFECTS ANALYSIS",
      blocks: [
        {
          type: "table",
          name: "failureModes",
          addableRows: true,
          minRows: 3,
          columns: [
            { key: "processStep", label: "Process Step / Requirement", kind: "textarea" },
            { key: "potentialFailureMode", label: "Potential Failure Mode", kind: "textarea" },
            { key: "potentialEffects", label: "Potential Effect(s) of Failure", kind: "textarea" },
            { key: "severity", label: "Severity", kind: "number", min: 1, max: 10 },
            { key: "class", label: "Class", kind: "text" },
            { key: "potentialCauses", label: "Potential Cause(s) / Mechanism(s)", kind: "textarea" },
            { key: "occurrence", label: "Occurrence", kind: "number", min: 1, max: 10 },
            { key: "controlsPrevention", label: "Current Controls — Prevention", kind: "textarea" },
            { key: "controlsDetection", label: "Current Controls — Detection", kind: "textarea" },
            { key: "detection", label: "Detection", kind: "number", min: 1, max: 10 },
            { key: "rpn", label: "R.P.N.", kind: "computed", formula: "rpn" },
            { key: "recommendedActions", label: "Recommended Action(s)", kind: "textarea" },
            { key: "responsibilityTargetDate", label: "Responsibility & Target Date", kind: "text" },
            { key: "actionsTaken", label: "Actions Taken & Completion Date", kind: "textarea" },
            { key: "severityRevised", label: "Severity (Revised)", kind: "number", min: 1, max: 10 },
            { key: "occurrenceRevised", label: "Occurrence (Revised)", kind: "number", min: 1, max: 10 },
            { key: "detectionRevised", label: "Detection (Revised)", kind: "number", min: 1, max: 10 },
            { key: "rpnRevised", label: "R.P.N. (Revised)", kind: "computed", formula: "rpnRevised" },
          ],
        },
      ],
    },
    {
      number: "3",
      title: "RATING SCALE REFERENCE",
      blocks: [
        {
          type: "textarea",
          name: "ratingReferenceNotes",
          label: "Severity / Occurrence / Detection Rating Notes:",
          hint:
            "Per AIAG scale: Severity 1=No effect … 10=Hazardous without warning. Occurrence 1=Almost never … 10=Very high (>1/10). " +
            "Detection 1=Almost certain to detect … 10=Almost impossible to detect. Record any company-specific scale deviations here.",
        },
      ],
    },
  ],
};
