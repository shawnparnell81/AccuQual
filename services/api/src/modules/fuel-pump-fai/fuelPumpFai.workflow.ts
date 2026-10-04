import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from "../workflow/workflow-engine.js";
import { FPM_NODE, FPM_PRODUCT_FAMILY, FPM_SLA_RULES, FPM_WORKFLOW_KEY, FPM_WORKFLOW_NAME, type FpmRoute } from "./fuelPumpFai.logic.js";

const QUALITY_MANAGER = { label: "Quality Manager", roleName: "quality_manager" };
const QUALITY_ENGINEER = { label: "Quality Engineer", roleName: "quality_engineer" };
const ENGINEERING_MANAGER = { label: "Engineering Manager", roleName: "engineering_manager" };
const OPERATIONS_MANAGER = { label: "Operations Manager", roleName: "operations_manager" };

function approval(id: string, label: string, config: Record<string, unknown>): WorkflowNode {
  return { id, type: "approval", kind: "approval", label, config: { workflowKey: FPM_WORKFLOW_KEY, ...config } };
}

function action(id: string, kind: string, label: string, config: Record<string, unknown> = {}): WorkflowNode {
  return { id, type: "action", kind, label, config: { workflowKey: FPM_WORKFLOW_KEY, ...config } };
}

function edge(from: string, to: string, branch?: string): WorkflowEdge {
  return { from, to, ...(branch ? { branch } : {}) };
}

function routes(items: FpmRoute[]): FpmRoute[] {
  return items;
}

const INSPECTOR = { label: "Inspector", roleName: "inspector" };

export const FPM_FAI_METADATA: Record<string, unknown> = {
  name: FPM_WORKFLOW_NAME,
  module: "fai",
  description: "Fuel Pump Module first article inspection for aftermarket automotive parts. Not an aerospace AS9102 form.",
  allowLoops: true,
  category: "quality",
  sla: {
    reminderAt: 0.75,
    warningAt: 0.9,
    escalationAfterOverdueDays: 3,
    overallCalendarDays: 30,
    notices: "in_app",
    businessDays: "Monday-Friday",
    holidayCalendar: false,
    steps: FPM_SLA_RULES,
    targets: {
      reminder: ["assigned owner"],
      warning: ["assigned owner", "Quality Manager"],
      overdue: ["assigned owner", "Quality Manager"],
      escalated: ["Quality Manager", "Operations Manager"],
      criticalFailure: ["Quality Manager", "Engineering Manager"],
    },
    storedTitles: [QUALITY_ENGINEER, QUALITY_MANAGER, ENGINEERING_MANAGER, OPERATIONS_MANAGER, { label: "FAI Originator" }],
  },
};

const NOT_APPROVED = "The fuel pump is not approved for production.";
const APPROVED = "The fuel pump is approved for production.";

function inspection(id: string, branch: string, label: string, verify: string[], message: string): WorkflowNode {
  return action(id, "fpm_inspect", label, {
    assignees: [INSPECTOR],
    assigneeField: "inspectorUserId",
    branch,
    verify,
    pauseUntil: `${branch}Ready`,
    signalsJoin: true,
    message,
    routes: routes([{ decision: "approved", label: "Branch complete", branch: "approved" }]),
  });
}

export const FPM_FAI_DEFINITION: WorkflowDefinition = {
  nodes: [
    {
      id: FPM_NODE.trigger,
      type: "trigger",
      kind: "fpm_fai_submitted",
      label: "Fuel Pump FAI Submitted",
      config: {
        required: ["Part Number", "Supplier", "Sample Lot Number", "Vehicle Application", "Inspector"],
        setStatus: "Submitted",
        setStage: "Document Review",
        productFamily: FPM_PRODUCT_FAMILY,
      },
    },
    approval(FPM_NODE.documentReview, "Document Review", {
      assignees: [QUALITY_ENGINEER],
      slaBusinessDays: 2,
      verify: ["Correct Part Number", "Correct Vehicle Application", "Current Specification Available", "Current Drawing Available", "Approved Test Method Available", "Sample Traceability Available"],
      message: "Verify the part number, vehicle application, current specification, current drawing, approved test method, and sample traceability.",
      routes: routes([
        { decision: "approved", label: "Approve", branch: "approved" },
        { decision: "return", label: "Return For Correction", branch: "return", revisit: true, commentsRequired: true },
        { decision: "rejected", label: "Reject", branch: "rejected", commentsRequired: true },
      ]),
    }),
    action(FPM_NODE.correct, "fpm_apply_correction", "Correct FAI Information", {
      assignees: [{ label: "FAI Originator" }],
      assigneeField: "openedBy",
      pauseUntil: "correctionReady",
      routes: routes([{ decision: "approved", label: "Submit correction", branch: "approved", commentsRequired: true }]),
    }),
    action(FPM_NODE.reject, "fpm_reject", "Reject FAI"),
    { id: FPM_NODE.endRejected, type: "end", kind: "end", label: "Fuel Pump FAI Rejected", config: { display: NOT_APPROVED } },
    {
      id: FPM_NODE.parallel,
      type: "parallel",
      kind: "fork",
      label: "Fuel Pump Validation Testing",
      config: { holdBranches: ["join"], slaBusinessDays: 5, branches: ["Visual Inspection", "Dimensional Inspection", "Electrical Testing", "Fuel Pump Functional Testing", "Fitment Verification", "Packaging Verification"] },
    },
    inspection(FPM_NODE.visual, "visual", "Visual Inspection", ["Correct Label", "Correct Connector", "No Housing Damage", "No Cracks", "No Corrosion", "No Missing Components", "No Loose Components", "No Damage To Terminals", "No Damage To Fuel Connections"], "Record Pass, Fail, comments, and photos."),
    inspection(FPM_NODE.dimensional, "dimensional", "Dimensional Inspection", ["Overall Height", "Overall Diameter", "Mounting Dimensions", "Connector Location", "Outlet Location", "Inlet Location"], "Record actual dimensions and Pass or Fail. Limits come only from an approved drawing, specification, or inspection plan. A missing limit is not a Pass."),
    inspection(FPM_NODE.electrical, "electrical", "Electrical Testing", ["Connector Continuity", "Terminal Continuity", "Resistance Values", "Polarity", "Current Draw"], "Record actual measurements and Pass or Fail. Limits come only from an approved specification."),
    inspection(FPM_NODE.functional, "functional", "Fuel Pump Functional Testing", ["Prime Function", "Flow Rate", "Pressure Output", "Pressure Stability", "Noise Level", "Leak Check", "Low Voltage Operation", "Normal Voltage Operation", "Current Draw"], "Record flow rate, pressure, current draw, noise result, and Pass or Fail. Limits come only from an approved specification."),
    inspection(FPM_NODE.fitment, "fitment", "Fitment Verification", ["Fuel Tank Fitment", "Lock Ring Fitment", "Seal Fitment", "Connector Fitment", "Fuel Line Connection Fitment", "Vehicle Application Verification"], "Record Pass, Fail, and photos."),
    inspection(FPM_NODE.packaging, "packaging", "Packaging Verification", ["Correct Carton", "Correct Label", "Correct Barcode", "Packaging Protection", "Included Components", "Instructions Present"], "Record Pass, Fail, and photos."),
    action(FPM_NODE.calculate, "fpm_calculate", "Calculate Results"),
    {
      id: FPM_NODE.attemptGate,
      type: "condition",
      kind: "condition",
      label: "Retest attempt?",
      config: { field: "attempt.number", greaterThan: 1 },
    },
    {
      id: FPM_NODE.failures,
      type: "condition",
      kind: "condition",
      label: "Any Failures?",
      config: { field: "failureDetected", equals: "Yes" },
    },
    {
      id: FPM_NODE.retestPassed,
      type: "condition",
      kind: "condition",
      label: "Retest Passed?",
      config: { field: "overallResult", equals: "Passed" },
    },
    {
      id: FPM_NODE.engineeringGate,
      type: "condition",
      kind: "condition",
      label: "Pending Engineering Review?",
      config: { field: "overallResult", equals: "Pending Engineering Review" },
    },
    approval(FPM_NODE.engineering, "Engineering Review", {
      assignees: [ENGINEERING_MANAGER],
      message: "A measurement has no approved limit. Accept it, supply the limit from the approved drawing or specification and retest, or classify it as a failure. Do not invent a limit.",
      routes: routes([
        { decision: "approved", label: "Accept", branch: "approved", commentsRequired: true },
        { decision: "retest", label: "Define Requirement and Retest", branch: "retest", revisit: true, commentsRequired: true },
        { decision: "rejected", label: "Classify as Failure", branch: "rejected", commentsRequired: true },
      ]),
    }),
    action(FPM_NODE.ncr, "fpm_create_ncr", "Create NCR"),
    action(FPM_NODE.corrective, "fpm_corrective_action", "Corrective Action", {
      assignees: [{ label: "FAI Originator" }, QUALITY_MANAGER],
      assigneeField: "openedBy",
      slaBusinessDays: 10,
      pauseUntil: "correctiveActionReady",
      required: ["root cause", "corrective action", "responsible person", "due date"],
      routes: routes([{ decision: "approved", label: "Submit corrective action", branch: "approved", commentsRequired: true }]),
    }),
    approval(FPM_NODE.retest, "Retest Approval", {
      assignees: [QUALITY_MANAGER],
      slaBusinessDays: 3,
      message: "Approve a new inspection attempt, send corrective action back, or reject the product. Failed results stay on the record. Production release stays No when the product is rejected.",
      routes: routes([
        { decision: "approved", label: "Approve Retest", branch: "approved", revisit: true },
        { decision: "return", label: "Return For Correction", branch: "return", revisit: true, commentsRequired: true },
        { decision: "rejected", label: "Reject Product", branch: "rejected", commentsRequired: true },
      ]),
    }),
    action(FPM_NODE.openAttempt, "fpm_open_attempt", "Open inspection attempt"),
    approval(FPM_NODE.finalApproval, "Final Quality Approval", {
      assignees: [QUALITY_MANAGER],
      slaBusinessDays: 2,
      verify: ["All tests complete", "No open NCR", "No failed results", "Evidence attached"],
      message: "Verify every test is complete, no NCR is open, no result failed, and evidence is attached. Production release is impossible without this approval.",
      routes: routes([
        { decision: "approved", label: "Approve", branch: "approved" },
        { decision: "rejected", label: "Reject", branch: "rejected", revisit: true, commentsRequired: true },
      ]),
    }),
    action(FPM_NODE.release, "fpm_release", "Release Product", {
      notify: [
        { label: "Quality", department: "quality" },
        { label: "Engineering", department: "engineering" },
        { label: "Purchasing", department: "purchasing" },
        { label: "Operations", department: "production" },
      ],
    }),
    action(FPM_NODE.archive, "fpm_archive", "Archive FAI"),
    { id: FPM_NODE.endApproved, type: "end", kind: "end", label: "Fuel Pump FAI Approved", config: { display: APPROVED } },
  ],
  edges: [
    edge(FPM_NODE.trigger, FPM_NODE.documentReview),
    edge(FPM_NODE.documentReview, FPM_NODE.parallel, "approved"),
    edge(FPM_NODE.documentReview, FPM_NODE.correct, "return"),
    edge(FPM_NODE.documentReview, FPM_NODE.reject, "rejected"),
    edge(FPM_NODE.correct, FPM_NODE.documentReview),
    edge(FPM_NODE.reject, FPM_NODE.endRejected),
    edge(FPM_NODE.parallel, FPM_NODE.visual, "visual"),
    edge(FPM_NODE.parallel, FPM_NODE.dimensional, "dimensional"),
    edge(FPM_NODE.parallel, FPM_NODE.electrical, "electrical"),
    edge(FPM_NODE.parallel, FPM_NODE.functional, "functional"),
    edge(FPM_NODE.parallel, FPM_NODE.fitment, "fitment"),
    edge(FPM_NODE.parallel, FPM_NODE.packaging, "packaging"),
    edge(FPM_NODE.parallel, FPM_NODE.calculate, "join"),
    edge(FPM_NODE.calculate, FPM_NODE.attemptGate),
    edge(FPM_NODE.attemptGate, FPM_NODE.retestPassed, "true"),
    edge(FPM_NODE.attemptGate, FPM_NODE.failures, "false"),
    edge(FPM_NODE.retestPassed, FPM_NODE.finalApproval, "true"),
    edge(FPM_NODE.retestPassed, FPM_NODE.failures, "false"),
    edge(FPM_NODE.failures, FPM_NODE.ncr, "true"),
    edge(FPM_NODE.failures, FPM_NODE.engineeringGate, "false"),
    edge(FPM_NODE.engineeringGate, FPM_NODE.engineering, "true"),
    edge(FPM_NODE.engineeringGate, FPM_NODE.finalApproval, "false"),
    edge(FPM_NODE.engineering, FPM_NODE.finalApproval, "approved"),
    edge(FPM_NODE.engineering, FPM_NODE.openAttempt, "retest"),
    edge(FPM_NODE.engineering, FPM_NODE.ncr, "rejected"),
    edge(FPM_NODE.ncr, FPM_NODE.corrective),
    edge(FPM_NODE.corrective, FPM_NODE.retest),
    edge(FPM_NODE.retest, FPM_NODE.openAttempt, "approved"),
    edge(FPM_NODE.retest, FPM_NODE.corrective, "return"),
    edge(FPM_NODE.retest, FPM_NODE.reject, "rejected"),
    edge(FPM_NODE.openAttempt, FPM_NODE.parallel),
    edge(FPM_NODE.finalApproval, FPM_NODE.release, "approved"),
    edge(FPM_NODE.finalApproval, FPM_NODE.ncr, "rejected"),
    edge(FPM_NODE.release, FPM_NODE.archive),
    edge(FPM_NODE.archive, FPM_NODE.endApproved),
  ],
};

export function fuelPumpWorkflowPayload(): { nodes: WorkflowNode[]; edges: WorkflowEdge[]; metadata: Record<string, unknown> } {
  return { nodes: FPM_FAI_DEFINITION.nodes, edges: FPM_FAI_DEFINITION.edges, metadata: FPM_FAI_METADATA };
}
