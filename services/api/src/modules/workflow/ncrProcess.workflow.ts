import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from "./workflow-engine.js";
import { NCR_SLA_RULES, NCR_SLA_SUMMARY } from "../ncr/ncrSla.js";

export const NCR_PROCESS_NAME = "NCR Process";

const SEVERITY_MAJOR_OR_CRITICAL = ["Major", "Critical", "major", "critical", "high", "medium"];
const YES = ["Yes", "yes", true];
const NO = ["No", "no", false];

function at(id: string, type: WorkflowNode["type"], kind: string, label: string, x: number, y: number, config: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, kind, label, position: { x, y }, config };
}

function step(id: string, label: string, x: number, y: number, config: Record<string, unknown>): WorkflowNode {
  return at(id, "action", "ncr_process", label, x, y, { process: "ncr", ...config });
}

function edge(from: string, to: string, branch?: string, label?: string): WorkflowEdge {
  return { from, to, ...(branch ? { branch } : {}), ...(label ? { label } : {}) };
}

const nodes: WorkflowNode[] = [
  at("t1", "trigger", "submitted", "NCR Submitted", 40, 80, {
    startEvent: "User submits the NCR form",
    mappedFields: ["ncr_number", "reported_by", "date_opened", "department", "part_number", "job_number", "lot_number", "supplier", "customer", "description", "severity", "ncr_type"],
    outputs: { status: "Submitted", workflow_stage: "Quality Review" },
  }),
  step("a2", "Initialize NCR", 320, 80, {
    workflowStage: "Quality Review",
    updates: { status: "Submitted", workflow_stage: "Quality Review", date_opened: "current date" },
    assignments: ["quality_manager", "department_manager"],
    notify: ["Quality Manager", "Department Manager"],
  }),
  at("p_side", "parallel", "parallel", "Side paths", 320, 520, {
    process: "ncr",
    note: "Open more than 30 days, customer NCR, and supplier NCR. These do not replace the main path.",
  }),
  at("c_open", "condition", "days_open", "Open more than 30 days", 600, 420, { field: "days_open", greaterThan: 30 }),
  step("a_open", "Escalate open NCR", 900, 420, {
    notify: ["Quality Manager", "Operations Manager", "Executive Sponsor"],
    updates: { escalation_level: "High" },
    note: "Return to the current step. The stage does not change.",
  }),
  at("c_cust", "condition", "ncr_type", "Customer NCR", 600, 620, { field: "ncr_type", in: ["Customer", "customer"] }),
  step("a_cust", "Customer response", 900, 620, {
    notify: ["Sales Manager", "Quality Manager"],
    fields: ["customer_response_due"],
    updates: { customer_response_due_hours: 48 },
  }),
  at("c_sup", "condition", "ncr_type", "Supplier NCR", 600, 820, { field: "ncr_type", in: ["Supplier", "supplier"] }),
  step("a_sup", "Create SCAR", 900, 820, {
    assignments: ["Supplier Quality Engineer"],
    notify: ["Supplier Quality Engineer", "Quality Manager"],
    fields: ["supplier_response", "supplier_corrective_actions"],
    note: "Quality record on scar_forms. The SCAR number stays blank until someone assigns one.",
  }),
  at("c_crit", "condition", "severity", "Critical NCR", 640, 80, { field: "severity", in: ["Critical", "critical"] }),
  step("a_crit", "Notify executives", 640, 300, {
    notify: ["President", "CEO", "Operations Director"],
    updates: { priority: "Critical" },
    note: "These titles are notification targets stored on this step.",
  }),
  at("ap_exec", "approval", "approval", "Executive Approval", 940, 300, {
    process: "ncr",
    assignees: ["President", "CEO", "Operations Director"],
    approvalMode: "any",
    message: "A Critical NCR needs executive approval before Quality Review.",
  }),
  at("ap3", "approval", "approval", "Quality Review", 1100, 80, {
    process: "ncr",
    workflowStage: "Quality Review",
    assignees: ["Quality Manager"],
    approvalMode: "all",
    requiredFields: ["severity", "disposition", "review_notes", "containment_required"],
    buttons: ["Approve", "Reject"],
    message: "Review severity, disposition, notes, and whether containment is required.",
  }),
  at("c4", "condition", "containment", "Containment Required?", 1400, 80, {
    anyOf: [
      { field: "severity", in: SEVERITY_MAJOR_OR_CRITICAL },
      { field: "containment_required", in: YES },
    ],
  }),
  step("a5", "Reject NCR", 1100, 360, {
    workflowStage: "Rejected",
    updates: { status: "Rejected", workflow_stage: "Rejected", rejected_date: "current date", rejected_by: "current user", rejection_reason: "approval comments" },
  }),
  at("e6", "end", "end", "NCR Rejected", 1400, 360),
  step("a7", "Containment Activities", 1400, 280, {
    workflowStage: "Containment",
    fields: ["containment_required", "containment_owner", "containment_action", "containment_date", "inventory_hold", "shipment_hold"],
    updates: { status: "Containment" },
    note: "inventory_hold and shipment_hold are yes/no fields on this NCR.",
  }),
  step("a8", "Root Cause Analysis", 1720, 80, {
    workflowStage: "Root Cause Analysis",
    requiredFields: ["root_cause_method", "root_cause", "escape_point", "contributing_factors"],
    rootCauseMethods: ["5 Why", "Fishbone", "8D", "FTA"],
    updates: { status: "Root Cause Analysis" },
  }),
  step("a9", "Corrective Action Planning", 2020, 80, {
    workflowStage: "Corrective Action",
    fields: ["corrective_action", "action_owner", "due_date"],
    updates: { status: "Corrective Action" },
  }),
  at("c_od", "condition", "corrective_action_overdue", "Corrective action overdue?", 2320, 80, { field: "corrective_action_overdue", equals: "Yes" }),
  step("a_od", "Raise overdue corrective action", 2320, 300, {
    notify: ["action owner", "Quality Manager"],
    updates: { priority: "raised", dashboard_alert: "Corrective action is overdue" },
  }),
  at("p10", "parallel", "parallel", "Implement Corrective Actions", 2620, 80, {
    process: "ncr",
    workflowStage: "Implementation",
    note: "Wait for procedure, training, and inspection updates.",
  }),
  step("a11", "Update Procedure", 2920, 0, {
    workflowStage: "Implementation",
    fields: ["procedure_update_required", "procedure_update_owner", "procedure_update_due_date", "procedure_update_complete", "procedure_evidence"],
    doneWhen: { procedure_update_complete: "Yes" },
  }),
  step("a12", "Operator Training", 2920, 180, {
    workflowStage: "Implementation",
    fields: ["training_required", "training_owner", "training_due_date", "training_complete", "training_evidence"],
    doneWhen: { training_complete: "Yes" },
  }),
  step("a13", "Inspection Plan Update", 2920, 360, {
    workflowStage: "Implementation",
    fields: ["inspection_update_required", "inspection_owner", "inspection_due_date", "inspection_update_complete", "inspection_evidence"],
    doneWhen: { inspection_update_complete: "Yes" },
  }),
  at("ap14", "approval", "approval", "Management Approval", 3240, 80, {
    process: "ncr",
    workflowStage: "Management Approval",
    assignees: ["Quality Manager", "Operations Manager"],
    approvalMode: "all",
    requiredFields: ["approval_comments", "approved_by", "approval_date"],
    buttons: ["Approve", "Return For Changes"],
    message: "Quality Manager and Operations Manager both approve, or return the plan for changes.",
  }),
  step("a15", "Effectiveness Verification", 3540, 80, {
    workflowStage: "Effectiveness Verification",
    fields: ["effective", "verification_notes", "verified_by", "verification_date", "recurrence_detected"],
    updates: { status: "Effectiveness Verification" },
  }),
  at("c16", "condition", "effective", "Effective?", 3840, 80, {
    allOf: [
      { field: "effective", in: YES },
      { field: "recurrence_detected", in: NO },
    ],
  }),
  step("a17", "Close NCR", 4140, 80, {
    workflowStage: "Closed",
    updates: { status: "Closed", workflow_stage: "Closed", date_closed: "current date", days_open: "date_closed minus date_opened", closure_notes: "verification notes" },
    note: "Generate the NCR PDF from the existing NCR layout, archive the record, and lock it.",
  }),
  at("e18", "end", "end", "NCR Closed", 4440, 80),
];

// First edge of a node runs first. Side paths run before the critical gate. There is no direct line from Initialize to Quality Review.
const edges: WorkflowEdge[] = [
  edge("t1", "a2"),
  edge("a2", "p_side"),
  edge("a2", "c_crit"),
  edge("p_side", "c_open"),
  edge("p_side", "c_cust"),
  edge("p_side", "c_sup"),
  edge("c_open", "a_open", "true", "Yes"),
  edge("a_open", "c_open", undefined, "Return to current step"),
  edge("c_cust", "a_cust", "true", "Yes"),
  edge("c_sup", "a_sup", "true", "Yes"),
  edge("c_crit", "a_crit", "true", "Yes"),
  edge("a_crit", "ap_exec"),
  edge("ap_exec", "ap3", "approved", "Continue"),
  edge("c_crit", "ap3", "false", "No"),
  edge("ap3", "c4", "approved", "Approve"),
  edge("ap3", "a5", "rejected", "Reject"),
  edge("a5", "e6"),
  edge("c4", "a7", "true", "Yes"),
  edge("c4", "a8", "false", "No"),
  edge("a7", "a8"),
  edge("a8", "a9"),
  edge("a9", "c_od"),
  edge("c_od", "p10", "false", "No"),
  edge("c_od", "a_od", "true", "Yes"),
  edge("a_od", "a9", undefined, "Return to the task"),
  edge("p10", "a11"),
  edge("p10", "a12"),
  edge("p10", "a13"),
  edge("a11", "ap14"),
  edge("a12", "ap14"),
  edge("a13", "ap14"),
  edge("ap14", "a15", "approved", "Approve"),
  edge("ap14", "a9", "rejected", "Return For Changes"),
  edge("a15", "c16"),
  edge("c16", "a17", "true", "Yes"),
  edge("c16", "a8", "false", "No"),
  edge("a17", "e18"),
];

export const ncrProcessDefinition: WorkflowDefinition = {
  nodes,
  edges,
  metadata: {
    name: NCR_PROCESS_NAME,
    module: "ncr",
    category: "quality",
    ownerDepartment: "quality",
    description: "One NCR process: quality review, containment, root cause, corrective action, implementation, approval, and effectiveness. Side paths and SLA rules stay on this workflow.",
    allowLoops: true,
    sla: NCR_SLA_RULES,
    slaSummary: NCR_SLA_SUMMARY,
  },
};
