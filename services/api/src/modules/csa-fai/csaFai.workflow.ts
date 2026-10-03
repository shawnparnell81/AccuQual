import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from "../workflow/workflow-engine.js";
import {
  CSA_NODE,
  CSA_PRODUCT_FAMILY,
  CSA_SLA_RULES,
  CSA_WORKFLOW_KEY,
  CSA_WORKFLOW_NAME,
  type CsaRoute,
} from "./csaFai.logic.js";

const QUALITY_MANAGER = { label: "Quality Manager", roleName: "quality_manager" };
const QUALITY_ENGINEER = { label: "Quality Engineer", roleName: "quality_engineer" };
const ENGINEERING_MANAGER = { label: "Engineering Manager", roleName: "engineering_manager" };
const PRODUCT_ENGINEER = { label: "Product Engineer", roleName: "product_engineer" };

function approval(
  id: string,
  label: string,
  config: Record<string, unknown>,
): WorkflowNode {
  return { id, type: "approval", kind: "approval", label, config: { workflowKey: CSA_WORKFLOW_KEY, ...config } };
}

function action(id: string, kind: string, label: string, config: Record<string, unknown> = {}): WorkflowNode {
  return { id, type: "action", kind, label, config: { workflowKey: CSA_WORKFLOW_KEY, ...config } };
}

function edge(from: string, to: string, branch?: string): WorkflowEdge {
  return { from, to, ...(branch ? { branch } : {}) };
}

function routes(items: CsaRoute[]): CsaRoute[] {
  return items;
}

export const CSA_FAI_METADATA: Record<string, unknown> = {
  name: CSA_WORKFLOW_NAME,
  module: "fai",
  description: "Complete Strut Assembly first article inspection for aftermarket automotive parts. Not an aerospace AS9102 form.",
  allowLoops: true,
  category: "quality",
  sla: {
    reminderAt: 0.75,
    escalationAfterOverdueBusinessDays: 3,
    overdueNotify: ["Step owner", "Quality Manager"],
    escalationNotify: ["Operations Manager"],
    notices: "in_app",
    steps: CSA_SLA_RULES,
  },
};

const NOT_APPROVED = "The CSA is not approved for production.";
const APPROVED = "The CSA is approved for production.";

export const CSA_FAI_DEFINITION: WorkflowDefinition = {
  nodes: [
    {
      id: CSA_NODE.trigger,
      type: "trigger",
      kind: "csa_fai_submitted",
      label: "CSA FAI Submitted",
      config: {
        required: [
          "FAI Number",
          "Part Number",
          "Part Description",
          "Supplier",
          "Supplier Part Number",
          "Sample Lot Number",
          "Vehicle Year",
          "Make",
          "Model",
          "Position",
          "Inspector",
          "Date Opened",
        ],
        setStatus: "Submitted",
        setStage: "Document Review",
        productFamily: CSA_PRODUCT_FAMILY,
      },
    },
    approval(CSA_NODE.documentReview, "Document Review", {
      assignees: [QUALITY_MANAGER, QUALITY_ENGINEER],
      message: "Verify part number, supplier, vehicle application, current drawing or approved spec, inspection criteria, sample traceability, and the OE or approved comparison sample when required.",
      routes: routes([
        { decision: "approved", label: "Approve", branch: "approved" },
        { decision: "return", label: "Return for Correction", branch: "return", revisit: true, commentsRequired: true },
        { decision: "rejected", label: "Reject", branch: "rejected", commentsRequired: true },
      ]),
    }),
    action(CSA_NODE.correct, "csa_apply_correction", "Correct FAI Information", {
      assignees: [{ label: "FAI Originator" }],
      assigneeField: "openedBy",
      pauseUntil: "correctionReady",
      routes: routes([{ decision: "approved", label: "Submit correction", branch: "approved", commentsRequired: true }]),
    }),
    action(CSA_NODE.reject, "csa_reject", "Reject FAI"),
    action("act_reject_product", "csa_reject", "Reject FAI"),
    { id: CSA_NODE.endRejected, type: "end", kind: "end", label: "FAI Rejected", config: { display: NOT_APPROVED } },
    {
      id: CSA_NODE.parallel,
      type: "parallel",
      kind: "fork",
      label: "Perform CSA Inspection",
      config: { holdBranches: ["join"] },
    },
    approval(CSA_NODE.component, "Component and Visual", {
      assignees: [{ label: "Inspector" }],
      assigneeField: "inspectorUserId",
      branch: "component",
      message: "Pass, Fail, or Not Applicable for each component and visual criterion. Photos and inspector comments are required for every failure.",
      routes: routes([{ decision: "approved", label: "Branch complete", branch: "approved" }]),
    }),
    approval(CSA_NODE.dimensional, "Dimensional", {
      assignees: [{ label: "Inspector" }],
      assigneeField: "inspectorUserId",
      branch: "dimensional",
      message: "Record actual, units, specified limits from the approved drawing, specification, or inspection plan, and equipment. A missing limit is Engineering Review Required.",
      routes: routes([{ decision: "approved", label: "Branch complete", branch: "approved" }]),
    }),
    approval(CSA_NODE.functional, "Functional", {
      assignees: [{ label: "Inspector" }],
      assigneeField: "inspectorUserId",
      branch: "functional",
      message: "Record functional results. Actual results and evidence are required when a measured requirement applies.",
      routes: routes([{ decision: "approved", label: "Branch complete", branch: "approved" }]),
    }),
    approval(CSA_NODE.fitment, "Fitment and Packaging", {
      assignees: [{ label: "Inspector" }],
      assigneeField: "inspectorUserId",
      branch: "fitment",
      message: "Record fitment and packaging, including package photos.",
      routes: routes([{ decision: "approved", label: "Branch complete", branch: "approved" }]),
    }),
    action(CSA_NODE.doneComponent, "csa_branch_finished", "Component and Visual complete", { signalsJoin: true, branch: "component" }),
    action(CSA_NODE.doneDimensional, "csa_branch_finished", "Dimensional complete", { signalsJoin: true, branch: "dimensional" }),
    action(CSA_NODE.doneFunctional, "csa_branch_finished", "Functional complete", { signalsJoin: true, branch: "functional" }),
    action(CSA_NODE.doneFitment, "csa_branch_finished", "Fitment and Packaging complete", { signalsJoin: true, branch: "fitment" }),
    action(CSA_NODE.calculate, "csa_calculate", "Calculate Inspection Result"),
    {
      id: CSA_NODE.passed,
      type: "condition",
      kind: "condition",
      label: "FAI Passed?",
      config: { field: "overallResult", equals: "Passed" },
    },
    {
      id: CSA_NODE.engineeringGate,
      type: "condition",
      kind: "condition",
      label: "Pending Engineering Review?",
      config: { field: "overallResult", equals: "Pending Engineering Review" },
    },
    approval(CSA_NODE.engineering, "Engineering Review", {
      assignees: [ENGINEERING_MANAGER, PRODUCT_ENGINEER],
      message: "Accept, define the requirement and retest, or classify the item as a failure. Comments are required.",
      routes: routes([
        { decision: "approved", label: "Accept", branch: "approved", commentsRequired: true },
        { decision: "retest", label: "Define Requirement and Retest", branch: "retest", revisit: true, commentsRequired: true },
        { decision: "rejected", label: "Classify as Failure", branch: "rejected", commentsRequired: true },
      ]),
    }),
    action(CSA_NODE.ncr, "csa_create_ncr", "Create NCR"),
    action(CSA_NODE.corrective, "csa_corrective_action", "Corrective Action", {
      assignees: [{ label: "FAI Originator" }, QUALITY_MANAGER],
      assigneeField: "openedBy",
      pauseUntil: "correctiveActionReady",
      routes: routes([{ decision: "approved", label: "Submit corrective action", branch: "approved", commentsRequired: true }]),
    }),
    approval(CSA_NODE.retest, "Retest Approval", {
      assignees: [QUALITY_MANAGER],
      message: "Approve a new inspection attempt, send corrective action back, or reject the product. Failed results stay on the record.",
      routes: routes([
        { decision: "approved", label: "Approve Retest", branch: "approved", revisit: true },
        { decision: "return", label: "Return for More Work", branch: "return", revisit: true, commentsRequired: true },
        { decision: "rejected", label: "Reject Product", branch: "rejected", commentsRequired: true },
      ]),
    }),
    action(CSA_NODE.openAttempt, "csa_open_attempt", "Open inspection attempt"),
    { id: CSA_NODE.endRetestRejected, type: "end", kind: "end", label: "CSA FAI Rejected", config: { display: NOT_APPROVED } },
    approval(CSA_NODE.finalApproval, "Final Quality Approval", {
      assignees: [QUALITY_MANAGER],
      message: "Verify every area, evidence, traceability, fitment and packaging, and the linked NCR when there is one. Production release is impossible with unresolved failures or without this approval.",
      routes: routes([
        { decision: "approved", label: "Approve", branch: "approved" },
        { decision: "return", label: "Return", branch: "return", revisit: true, commentsRequired: true },
        { decision: "rejected", label: "Reject", branch: "rejected", commentsRequired: true },
      ]),
    }),
    action(CSA_NODE.release, "csa_release", "Release CSA", {
      notify: [
        { label: "Quality", department: "quality" },
        { label: "Engineering", department: "engineering" },
        { label: "Purchasing", department: "purchasing" },
        { label: "Operations", department: "production" },
        { label: "Product Management", assignee: "Product Management" },
      ],
    }),
    action(CSA_NODE.archive, "csa_archive", "Archive FAI"),
    { id: CSA_NODE.endApproved, type: "end", kind: "end", label: "CSA FAI Approved", config: { display: APPROVED } },
  ],
  edges: [
    edge(CSA_NODE.trigger, CSA_NODE.documentReview),
    edge(CSA_NODE.documentReview, CSA_NODE.parallel, "approved"),
    edge(CSA_NODE.documentReview, CSA_NODE.correct, "return"),
    edge(CSA_NODE.documentReview, CSA_NODE.reject, "rejected"),
    edge(CSA_NODE.correct, CSA_NODE.documentReview),
    edge(CSA_NODE.reject, CSA_NODE.endRejected),
    edge(CSA_NODE.parallel, CSA_NODE.component, "component"),
    edge(CSA_NODE.parallel, CSA_NODE.dimensional, "dimensional"),
    edge(CSA_NODE.parallel, CSA_NODE.functional, "functional"),
    edge(CSA_NODE.parallel, CSA_NODE.fitment, "fitment"),
    edge(CSA_NODE.parallel, CSA_NODE.calculate, "join"),
    edge(CSA_NODE.component, CSA_NODE.doneComponent, "approved"),
    edge(CSA_NODE.dimensional, CSA_NODE.doneDimensional, "approved"),
    edge(CSA_NODE.functional, CSA_NODE.doneFunctional, "approved"),
    edge(CSA_NODE.fitment, CSA_NODE.doneFitment, "approved"),
    edge(CSA_NODE.calculate, CSA_NODE.passed),
    edge(CSA_NODE.passed, CSA_NODE.finalApproval, "true"),
    edge(CSA_NODE.passed, CSA_NODE.engineeringGate, "false"),
    edge(CSA_NODE.engineeringGate, CSA_NODE.engineering, "true"),
    edge(CSA_NODE.engineeringGate, CSA_NODE.ncr, "false"),
    edge(CSA_NODE.engineering, CSA_NODE.finalApproval, "approved"),
    edge(CSA_NODE.engineering, CSA_NODE.openAttempt, "retest"),
    edge(CSA_NODE.engineering, CSA_NODE.ncr, "rejected"),
    edge(CSA_NODE.ncr, CSA_NODE.corrective),
    edge(CSA_NODE.corrective, CSA_NODE.retest),
    edge(CSA_NODE.retest, CSA_NODE.openAttempt, "approved"),
    edge(CSA_NODE.retest, CSA_NODE.corrective, "return"),
    edge(CSA_NODE.retest, "act_reject_product", "rejected"),
    edge("act_reject_product", CSA_NODE.endRetestRejected),
    edge(CSA_NODE.openAttempt, CSA_NODE.parallel),
    edge(CSA_NODE.finalApproval, CSA_NODE.release, "approved"),
    edge(CSA_NODE.finalApproval, CSA_NODE.openAttempt, "return"),
    edge(CSA_NODE.finalApproval, CSA_NODE.ncr, "rejected"),
    edge(CSA_NODE.release, CSA_NODE.archive),
    edge(CSA_NODE.archive, CSA_NODE.endApproved),
  ],
};

export function csaWorkflowPayload(): { nodes: WorkflowNode[]; edges: WorkflowEdge[]; metadata: Record<string, unknown> } {
  return { nodes: CSA_FAI_DEFINITION.nodes, edges: CSA_FAI_DEFINITION.edges, metadata: CSA_FAI_METADATA };
}
