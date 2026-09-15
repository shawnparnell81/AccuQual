export interface QmsFormColumn {
  key: string;
  label: string;
}
export interface QmsFormSection {
  key: string;
  label: string;
  columns: QmsFormColumn[];
}
export interface QmsFormDefinition {
  formType: string;
  title: string;
  subtitle: string;
  sections: QmsFormSection[];
  /**
   * Where this form lives in the Document Folders tree — [department,
   * folder, subfolder] names, matching defaultDocumentFolders.ts exactly.
   * Purely for the folder explorer's "Open Form" link and this module's own
   * folder-coverage report; not a live DB relationship (folder names are
   * the default seed's, so a tenant that renames a folder loses the link —
   * see the module review).
   */
  folderPath: [string, string, string];
}

/**
 * All 35 of the "ACCUQUAL Forms" batch's 37 real forms that share the one
 * generic shape (header + named table sections + comments) — see
 * qmsForms.ts's schema comment for why forms 01 (Document Change Request)
 * and 37 (Automotive Manufacturing Work Order) are NOT here. Every
 * title/subtitle/section/column below was extracted directly from the
 * user's own supplied .docx/.pdf files, not invented.
 */
export const QMS_FORM_DEFINITIONS: QmsFormDefinition[] = [
  {
    formType: "document_revision_record",
    title: "Document Revision Record",
    subtitle: "Records revisions, approvals, and release history.",
    sections: [
      { key: "revision_history", label: "Revision History", columns: [
        { key: "rev", label: "Rev." }, { key: "date", label: "Date" }, { key: "descriptionOfChange", label: "Description of Change" },
        { key: "author", label: "Author" }, { key: "reviewer", label: "Reviewer" }, { key: "approval", label: "Approval" },
      ] },
    ],
    folderPath: ["Quality", "Document Control", "Revision History"],
  },
  {
    formType: "master_document_register",
    title: "Master Document Register",
    subtitle: "Master index for controlled QMS documents.",
    sections: [
      { key: "controlled_documents", label: "Controlled Documents", columns: [
        { key: "documentId", label: "Document ID" }, { key: "title", label: "Title" }, { key: "rev", label: "Rev." },
        { key: "owner", label: "Owner" }, { key: "location", label: "Location" }, { key: "status", label: "Status" }, { key: "reviewDue", label: "Review Due" },
      ] },
    ],
    folderPath: ["Quality", "Document Control", "Master Document List"],
  },
  {
    formType: "record_retention_log",
    title: "Record Retention Log",
    subtitle: "Defines retention, storage, protection, and disposition of records.",
    sections: [
      { key: "record_register", label: "Record Register", columns: [
        { key: "recordType", label: "Record Type" }, { key: "owner", label: "Owner" }, { key: "storageLocation", label: "Storage Location" },
        { key: "retentionPeriod", label: "Retention Period" }, { key: "protection", label: "Protection" }, { key: "disposition", label: "Disposition" }, { key: "notes", label: "Notes" },
      ] },
    ],
    folderPath: ["Quality", "Document Control", "Record Retention Log"],
  },
  {
    formType: "quality_objectives_action_plan",
    title: "Quality Objectives & Action Plan",
    subtitle: "Tracks measurable quality objectives and action plans.",
    sections: [
      { key: "objectives", label: "Objectives", columns: [
        { key: "objective", label: "Objective" }, { key: "metricKpi", label: "Metric / KPI" }, { key: "baseline", label: "Baseline" },
        { key: "target", label: "Target" }, { key: "owner", label: "Owner" }, { key: "dueDate", label: "Due Date" }, { key: "status", label: "Status" },
      ] },
      { key: "progress_review", label: "Progress Review", columns: [
        { key: "date", label: "Date" }, { key: "result", label: "Result" }, { key: "trend", label: "Trend" },
        { key: "actionNeeded", label: "Action Needed" }, { key: "responsible", label: "Responsible" }, { key: "completion", label: "Completion" },
      ] },
    ],
    folderPath: ["Quality", "Quality Manual & Policies", "Quality Objectives & Action Plans"],
  },
  {
    formType: "preventive_risk_action",
    title: "Preventive / Risk Reduction Action",
    subtitle: "Tracks proactive actions to prevent potential problems.",
    sections: [
      { key: "action", label: "Action", columns: [
        { key: "actionId", label: "Action ID" }, { key: "potentialFailure", label: "Potential Failure" }, { key: "risk", label: "Risk" },
        { key: "preventiveAction", label: "Preventive Action" }, { key: "owner", label: "Owner" }, { key: "dueDate", label: "Due Date" }, { key: "status", label: "Status" },
      ] },
    ],
    folderPath: ["Quality", "Corrective & Preventive Actions", "Preventive Actions"],
  },
  {
    formType: "supplier_qualification_evaluation",
    title: "Supplier Qualification & Evaluation",
    subtitle: "Evaluates and approves external providers.",
    sections: [
      { key: "supplier_profile", label: "Supplier Profile", columns: [
        { key: "supplier", label: "Supplier" }, { key: "commodityService", label: "Commodity / Service" }, { key: "contact", label: "Contact" },
        { key: "approvalDate", label: "Approval Date" }, { key: "approvedBy", label: "Approved By" }, { key: "status", label: "Status" },
      ] },
      { key: "evaluation", label: "Evaluation", columns: [
        { key: "criterion", label: "Criterion" }, { key: "weight", label: "Weight" }, { key: "score", label: "Score" },
        { key: "evidenceComments", label: "Evidence / Comments" }, { key: "result", label: "Result" }, { key: "reEvaluationDate", label: "Re-Evaluation Date" },
      ] },
      { key: "performance", label: "Performance", columns: [
        { key: "quality", label: "Quality" }, { key: "delivery", label: "Delivery" }, { key: "responsiveness", label: "Responsiveness" }, { key: "decision", label: "Decision" },
      ] },
    ],
    folderPath: ["Purchasing", "Supplier Management", "Supplier Qualification & Evaluation"],
  },
  {
    formType: "po_quality_requirements",
    title: "Purchasing / Supplier Quality Requirements",
    subtitle: "Defines quality requirements for purchased products and services.",
    sections: [
      { key: "requirements", label: "Requirements", columns: [
        { key: "poSupplier", label: "PO / Supplier" }, { key: "itemService", label: "Item / Service" }, { key: "specificationDrawing", label: "Specification / Drawing" },
        { key: "acceptanceCriteria", label: "Acceptance Criteria" }, { key: "certificatesRequired", label: "Certificates Required" }, { key: "specialRequirements", label: "Special Requirements" },
      ] },
    ],
    folderPath: ["Purchasing", "Compliance & Documentation", "PO Quality Requirements"],
  },
  {
    formType: "incoming_inspection_record",
    title: "Incoming Inspection Record",
    subtitle: "Records inspection and acceptance of incoming materials.",
    sections: [
      { key: "receipt", label: "Receipt", columns: [
        { key: "receiptNo", label: "Receipt No." }, { key: "supplier", label: "Supplier" }, { key: "poNo", label: "PO No." },
        { key: "partMaterial", label: "Part / Material" }, { key: "lotBatch", label: "Lot / Batch" }, { key: "qty", label: "Qty" }, { key: "date", label: "Date" },
      ] },
      { key: "inspection", label: "Inspection", columns: [
        { key: "characteristic", label: "Characteristic" }, { key: "specification", label: "Specification" }, { key: "measuredObserved", label: "Measured / Observed" },
        { key: "instrument", label: "Instrument" }, { key: "result", label: "Result" }, { key: "inspector", label: "Inspector" },
      ] },
      { key: "disposition", label: "Disposition", columns: [
        { key: "overallResult", label: "Overall Result" }, { key: "ncrNo", label: "NCR No." }, { key: "releaseHoldReject", label: "Release / Hold / Reject" },
        { key: "approvedBy", label: "Approved By" }, { key: "date", label: "Date" },
      ] },
    ],
    folderPath: ["Shipping & Receiving", "Incoming Inspection", "Incoming Inspection Record"],
  },
  {
    formType: "first_article_inspection",
    title: "First Article Inspection Report",
    subtitle: "Documents first-article verification against design requirements.",
    sections: [
      { key: "part_information", label: "Part Information", columns: [
        { key: "partNo", label: "Part No." }, { key: "partName", label: "Part Name" }, { key: "drawingRev", label: "Drawing Rev." },
        { key: "poJob", label: "PO / Job" }, { key: "supplier", label: "Supplier" }, { key: "faiDate", label: "FAI Date" },
      ] },
      { key: "inspection_results", label: "Inspection Results", columns: [
        { key: "characteristicNo", label: "Characteristic No." }, { key: "requirement", label: "Requirement" }, { key: "actual", label: "Actual" },
        { key: "method", label: "Method" }, { key: "result", label: "Result" }, { key: "inspector", label: "Inspector" },
      ] },
      { key: "conclusion", label: "Conclusion", columns: [
        { key: "faiStatus", label: "FAI Status" }, { key: "deviationsNcrs", label: "Deviations / NCRs" }, { key: "approval", label: "Approval" }, { key: "date", label: "Date" },
      ] },
    ],
    folderPath: ["Quality", "Production & Inspection", "First Article Inspection (FAI)"],
  },
  {
    formType: "in_process_inspection",
    title: "In-Process Inspection Record",
    subtitle: "Records inspections performed during manufacturing or service delivery.",
    sections: [
      { key: "production_details", label: "Production Details", columns: [
        { key: "workOrder", label: "Work Order" }, { key: "partProduct", label: "Part / Product" }, { key: "operation", label: "Operation" },
        { key: "machineCell", label: "Machine / Cell" }, { key: "lot", label: "Lot" }, { key: "date", label: "Date" },
      ] },
      { key: "inspection", label: "Inspection", columns: [
        { key: "characteristic", label: "Characteristic" }, { key: "specification", label: "Specification" }, { key: "actual", label: "Actual" },
        { key: "frequency", label: "Frequency" }, { key: "result", label: "Result" }, { key: "inspector", label: "Inspector" },
      ] },
    ],
    folderPath: ["Quality", "Production & Inspection", "In-Process Inspection"],
  },
  {
    formType: "final_inspection_release",
    title: "Final Inspection & Release Record",
    subtitle: "Authorizes final product or service release.",
    sections: [
      { key: "order_product", label: "Order / Product", columns: [
        { key: "workOrder", label: "Work Order" }, { key: "customer", label: "Customer" }, { key: "product", label: "Product" },
        { key: "quantity", label: "Quantity" }, { key: "revision", label: "Revision" }, { key: "date", label: "Date" },
      ] },
      { key: "final_checks", label: "Final Checks", columns: [
        { key: "requirementCharacteristic", label: "Requirement / Characteristic" }, { key: "resultEvidence", label: "Result / Evidence" },
        { key: "inspector", label: "Inspector" }, { key: "status", label: "Status" },
      ] },
      { key: "release", label: "Release", columns: [
        { key: "finalStatus", label: "Final Status" }, { key: "releaseBy", label: "Release By" }, { key: "signature", label: "Signature" },
        { key: "date", label: "Date" }, { key: "comments", label: "Comments" },
      ] },
    ],
    folderPath: ["Quality", "Production & Inspection", "Final Inspection"],
  },
  {
    formType: "training_matrix",
    title: "Training Matrix",
    subtitle: "Tracks required and completed training by role or employee.",
    sections: [
      { key: "training_matrix", label: "Training Matrix", columns: [
        { key: "employeeRole", label: "Employee / Role" }, { key: "requiredTraining", label: "Required Training" }, { key: "completed", label: "Completed" },
        { key: "date", label: "Date" }, { key: "competency", label: "Competency" }, { key: "dueRefreshDate", label: "Due / Refresh Date" }, { key: "status", label: "Status" },
      ] },
    ],
    folderPath: ["Quality", "Training & Competency", "Training Matrix"],
  },
  {
    formType: "customer_satisfaction_record",
    title: "Customer Satisfaction Record",
    subtitle: "Captures customer satisfaction measures and follow-up.",
    sections: [
      { key: "feedback", label: "Feedback", columns: [
        { key: "customer", label: "Customer" }, { key: "source", label: "Source" }, { key: "date", label: "Date" },
        { key: "metricQuestion", label: "Metric / Question" }, { key: "result", label: "Result" }, { key: "trend", label: "Trend" },
      ] },
      { key: "action", label: "Action", columns: [
        { key: "issueOpportunity", label: "Issue / Opportunity" }, { key: "action", label: "Action" }, { key: "owner", label: "Owner" },
        { key: "dueDate", label: "Due Date" }, { key: "status", label: "Status" },
      ] },
    ],
    folderPath: ["Sales and Marketing", "Customer Data / Requirements", "Customer Satisfaction Reports"],
  },
  {
    formType: "product_traceability_record",
    title: "Product Traceability Record",
    subtitle: "Tracks materials, lots, batches, work orders, and release records.",
    sections: [
      { key: "traceability", label: "Traceability", columns: [
        { key: "productPart", label: "Product / Part" }, { key: "serialLotBatch", label: "Serial / Lot / Batch" }, { key: "supplierLot", label: "Supplier Lot" },
        { key: "materialCert", label: "Material Cert." }, { key: "workOrder", label: "Work Order" }, { key: "processStation", label: "Process / Station" },
        { key: "inspector", label: "Inspector" }, { key: "releaseDate", label: "Release Date" },
      ] },
    ],
    folderPath: ["Material Management", "Traceability", "Lot Traceability"],
  },
  {
    formType: "deviation_waiver_request",
    title: "Deviation / Waiver Request",
    subtitle: "Controls temporary departures from specified requirements.",
    sections: [
      { key: "request", label: "Request", columns: [
        { key: "requestNo", label: "Request No." }, { key: "productProcess", label: "Product / Process" }, { key: "requirement", label: "Requirement" },
        { key: "deviationRequested", label: "Deviation Requested" }, { key: "reason", label: "Reason" }, { key: "duration", label: "Duration" },
      ] },
      { key: "risk_approval", label: "Risk & Approval", columns: [
        { key: "riskAssessment", label: "Risk Assessment" }, { key: "customerImpact", label: "Customer Impact" }, { key: "containment", label: "Containment" },
        { key: "approvalsRequired", label: "Approvals Required" }, { key: "decision", label: "Decision" }, { key: "expiration", label: "Expiration" },
      ] },
    ],
    folderPath: ["Quality", "Nonconformance Management", "Deviation / Waiver Requests"],
  },
  {
    formType: "change_control_record",
    title: "Change Control Record",
    subtitle: "Controls changes affecting products, processes, equipment, software, or QMS.",
    sections: [
      { key: "change", label: "Change", columns: [
        { key: "changeId", label: "Change ID" }, { key: "area", label: "Area" }, { key: "currentState", label: "Current State" },
        { key: "proposedChange", label: "Proposed Change" }, { key: "reason", label: "Reason" }, { key: "owner", label: "Owner" }, { key: "effectiveDate", label: "Effective Date" },
      ] },
      { key: "impact_approval", label: "Impact & Approval", columns: [
        { key: "riskImpact", label: "Risk / Impact" }, { key: "verificationValidation", label: "Verification / Validation" }, { key: "trainingCommunication", label: "Training / Communication" },
        { key: "approvals", label: "Approvals" }, { key: "implementationStatus", label: "Implementation Status" },
      ] },
    ],
    folderPath: ["Quality", "Records", "Change Control Records"],
  },
  {
    formType: "management_review_record",
    title: "Management Review Record",
    subtitle: "Documents management review inputs, outputs, decisions, and actions.",
    sections: [
      { key: "meeting", label: "Meeting", columns: [
        { key: "meetingDate", label: "Meeting Date" }, { key: "chair", label: "Chair" }, { key: "attendees", label: "Attendees" },
        { key: "periodReviewed", label: "Period Reviewed" }, { key: "location", label: "Location" },
      ] },
      { key: "inputs", label: "Inputs", columns: [
        { key: "agendaInput", label: "Agenda / Input" }, { key: "evidenceKpi", label: "Evidence / KPI" }, { key: "discussionResult", label: "Discussion / Result" }, { key: "actionNeeded", label: "Action Needed" },
      ] },
      { key: "outputs_actions", label: "Outputs / Actions", columns: [
        { key: "decisionAction", label: "Decision / Action" }, { key: "owner", label: "Owner" }, { key: "dueDate", label: "Due Date" }, { key: "resources", label: "Resources" }, { key: "status", label: "Status" },
      ] },
    ],
    folderPath: ["Quality", "Quality Manual & Policies", "Management Review Records"],
  },
  {
    formType: "quality_kpi_monitoring",
    title: "Quality KPI Monitoring Form",
    subtitle: "Tracks key quality performance indicators and trends.",
    sections: [
      { key: "kpi_register", label: "KPI Register", columns: [
        { key: "kpi", label: "KPI" }, { key: "definition", label: "Definition" }, { key: "target", label: "Target" }, { key: "period", label: "Period" },
        { key: "actual", label: "Actual" }, { key: "trend", label: "Trend" }, { key: "owner", label: "Owner" }, { key: "action", label: "Action" },
      ] },
    ],
    folderPath: ["Quality", "Production & Inspection", "Production Quality KPIs"],
  },
  {
    formType: "environmental_condition_record",
    title: "Environmental / Work Condition Record",
    subtitle: "Records controlled environmental or workplace conditions where required.",
    sections: [
      { key: "conditions", label: "Conditions", columns: [
        { key: "dateTime", label: "Date / Time" }, { key: "areaProcess", label: "Area / Process" }, { key: "parameter", label: "Parameter" },
        { key: "requirement", label: "Requirement" }, { key: "actual", label: "Actual" }, { key: "instrument", label: "Instrument" }, { key: "result", label: "Result" }, { key: "action", label: "Action" },
      ] },
    ],
    folderPath: ["Production", "Safety & Compliance", "Environmental Condition Records"],
  },
  {
    formType: "audit_finding_action_log",
    title: "Audit Finding & Action Log",
    subtitle: "Central tracker for audit findings and closure.",
    sections: [
      { key: "findings", label: "Findings", columns: [
        { key: "findingId", label: "Finding ID" }, { key: "audit", label: "Audit" }, { key: "requirement", label: "Requirement" }, { key: "finding", label: "Finding" },
        { key: "owner", label: "Owner" }, { key: "dueDate", label: "Due Date" }, { key: "status", label: "Status" }, { key: "verification", label: "Verification" },
      ] },
    ],
    folderPath: ["Quality", "Audits", "Audit Findings"],
  },
  {
    formType: "quality_record_disposition",
    title: "Quality Record Disposition Form",
    subtitle: "Authorizes retention, archival, transfer, or destruction of quality records.",
    sections: [
      { key: "records", label: "Records", columns: [
        { key: "recordType", label: "Record Type" }, { key: "dateRange", label: "Date Range" }, { key: "quantity", label: "Quantity" },
        { key: "retentionRequirement", label: "Retention Requirement" }, { key: "storage", label: "Storage" }, { key: "dispositionDate", label: "Disposition Date" }, { key: "method", label: "Method" },
      ] },
      { key: "authorization", label: "Authorization", columns: [
        { key: "reviewedBy", label: "Reviewed By" }, { key: "approvedBy", label: "Approved By" }, { key: "date", label: "Date" }, { key: "comments", label: "Comments" },
      ] },
    ],
    folderPath: ["Quality", "Document Control", "Quality Record Disposition"],
  },
  {
    formType: "design_history_form",
    title: "Design History Form",
    subtitle: "Blank form — complete applicable fields and retain supporting records per your QMS requirements.",
    sections: [
      { key: "history", label: "Design History", columns: [
        { key: "idPhase", label: "ID / Phase" }, { key: "designInputOutput", label: "Design Input / Output" }, { key: "requirementCriterion", label: "Requirement / Criterion" },
        { key: "evidenceRecord", label: "Evidence / Record" }, { key: "reviewApproval", label: "Review / Approval" }, { key: "status", label: "Status" },
      ] },
    ],
    folderPath: ["Engineering", "Design & Development", "DHF (Design History File)"],
  },
];

export function getQmsFormDefinition(formType: string): QmsFormDefinition | undefined {
  return QMS_FORM_DEFINITIONS.find((d) => d.formType === formType);
}
