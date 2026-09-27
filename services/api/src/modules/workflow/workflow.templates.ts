import type { WorkflowDefinition } from "./workflow-engine.js";

export interface WorkflowTemplate {
  key: string;
  name: string;
  module: string;
  description: string;
  definition: WorkflowDefinition;
}

/**
 * Phase 9 task 6 — starter templates for the 8 modules the brief names.
 * Every trigger `kind` below is a REAL event string one of these modules'
 * own `publishEvent(WORKFLOW_STREAM, {module, event, ...})` calls already
 * emits today (verified directly against each module's own controller —
 * see this phase's own research and the two real gaps it closed:
 * eight_d/documents had no event at all before this phase, closed
 * alongside this template work so these two templates have something real
 * to react to). Loading a template into the builder (GET /workflow/templates)
 * pre-fills the node editor only — nothing is created or activated until
 * the company explicitly reviews and saves it as their own workflow_definitions
 * row, same as hand-building one from scratch.
 */
export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    key: "ncr_closure_notification",
    name: "NCR Closure Notification",
    module: "ncr",
    description: "When an NCR is closed, notify Quality and draft an AI summary note.",
    definition: {
      nodes: [
        { id: "t1", type: "trigger", kind: "closed", config: {} },
        { id: "a1", type: "action", kind: "notify_department", config: { department: "quality", subject: "NCR #{{entityId}} closed", body: "NCR #{{entityId}} was just closed." } },
        { id: "a2", type: "action", kind: "ai_suggestion", config: {} },
      ],
      edges: [
        { from: "t1", to: "a1" },
        { from: "t1", to: "a2" },
      ],
    },
  },
  {
    key: "capa_effectiveness_close",
    name: "CAPA Closure Notification",
    module: "capa",
    description: "When a CAPA is closed, notify Quality.",
    definition: {
      nodes: [
        { id: "t1", type: "trigger", kind: "close", config: {} },
        { id: "a1", type: "action", kind: "notify_department", config: { department: "quality", subject: "CAPA #{{entityId}} closed", body: "CAPA #{{entityId}} was just closed." } },
      ],
      edges: [{ from: "t1", to: "a1" }],
    },
  },
  {
    key: "eight_d_closure",
    name: "8D Closure Notification",
    module: "eight_d",
    description: "When an 8D report's D8 step is completed (the report closes), notify Quality.",
    definition: {
      nodes: [
        { id: "t1", type: "trigger", kind: "closed", config: {} },
        { id: "a1", type: "action", kind: "notify_department", config: { department: "quality", subject: "8D Report #{{entityId}} closed", body: "8D Report #{{entityId}}'s D8 step was just completed." } },
      ],
      edges: [{ from: "t1", to: "a1" }],
    },
  },
  {
    key: "receiving_rejection_escalation",
    name: "Receiving Rejection Escalation",
    module: "receiving",
    description: "When a receiving line item is rejected or quarantined, notify Quality and Material Management (Phase 8's own auto-NCR/CAPA logic already handles the NCR/CAPA side of this — this template covers the notification side).",
    definition: {
      nodes: [
        { id: "t1", type: "trigger", kind: "rejected", config: {} },
        { id: "t2", type: "trigger", kind: "quarantined", config: {} },
        { id: "a1", type: "action", kind: "notify_department", config: { department: "quality", subject: "Receiving line item #{{entityId}} rejected/quarantined", body: "Receiving line item #{{entityId}} needs review." } },
        { id: "a2", type: "action", kind: "notify_department", config: { department: "material_management", subject: "Receiving line item #{{entityId}} rejected/quarantined", body: "Receiving line item #{{entityId}} needs review." } },
      ],
      edges: [
        { from: "t1", to: "a1" },
        { from: "t1", to: "a2" },
        { from: "t2", to: "a1" },
        { from: "t2", to: "a2" },
      ],
    },
  },
  {
    key: "rma_closure_notification",
    name: "RMA Closure Notification",
    module: "rma",
    description: "When an RMA closes, notify Customer Service.",
    definition: {
      nodes: [
        { id: "t1", type: "trigger", kind: "closed", config: {} },
        { id: "a1", type: "action", kind: "notify_department", config: { department: "customer_service", subject: "RMA #{{entityId}} closed", body: "RMA #{{entityId}} was just closed." } },
      ],
      edges: [{ from: "t1", to: "a1" }],
    },
  },
  {
    key: "warranty_rejection_notification",
    name: "Warranty Rejection Notification",
    module: "warranty",
    description: "When a warranty claim is rejected, notify Customer Service.",
    definition: {
      nodes: [
        { id: "t1", type: "trigger", kind: "rejected", config: {} },
        { id: "a1", type: "action", kind: "notify_department", config: { department: "customer_service", subject: "Warranty claim #{{entityId}} rejected", body: "Warranty claim #{{entityId}} was rejected." } },
      ],
      edges: [{ from: "t1", to: "a1" }],
    },
  },
  {
    key: "supplier_car_rejection",
    name: "Supplier Corrective Action Rejection",
    module: "supplier_car",
    description: "When a supplier's corrective-action response is rejected, notify the supplier directly.",
    definition: {
      nodes: [
        { id: "t1", type: "trigger", kind: "rejected", config: {} },
        { id: "a1", type: "action", kind: "notify_supplier", config: { subject: "Your corrective action response needs revision", body: "Your submitted corrective action response was reviewed and needs revision — please resubmit." } },
      ],
      edges: [{ from: "t1", to: "a1" }],
    },
  },
  {
    key: "document_revision_approval",
    name: "Document Revision Approval Notification",
    module: "documents",
    description: "When a document revision is approved, notify Quality.",
    definition: {
      nodes: [
        { id: "t1", type: "trigger", kind: "approved", config: {} },
        { id: "a1", type: "action", kind: "notify_department", config: { department: "quality", subject: "Document #{{entityId}} approved", body: "A new revision of Document #{{entityId}} was just approved." } },
      ],
      edges: [{ from: "t1", to: "a1" }],
    },
  },
  {
    key: "validation",
    name: "Validation",
    module: "validation",
    description:
      "Manufacturing process or equipment validation. Each step waits for a sign-off before the next one starts. Rejecting a step stops the run. The Validation Report step points at the Validation Reports folder.",
    definition: {
      nodes: [
        { id: "t1", type: "trigger", kind: "started", label: "Validation started", config: {} },
        {
          id: "s1",
          type: "approval",
          kind: "approval",
          label: "Validation Plan/Protocol drafted",
          config: { approverDepartment: "engineering", message: "Confirm the validation plan and protocol are drafted." },
        },
        {
          id: "s2",
          type: "approval",
          kind: "approval",
          label: "Protocol review & approval",
          config: { approverRole: "quality_manager", approverDepartment: "quality", message: "Review and approve the validation protocol." },
        },
        {
          id: "s3",
          type: "approval",
          kind: "approval",
          label: "IQ (Installation Qualification)",
          config: { approverDepartment: "engineering", message: "Confirm installation qualification is complete." },
        },
        {
          id: "s4",
          type: "approval",
          kind: "approval",
          label: "OQ (Operational Qualification)",
          config: { approverDepartment: "engineering", message: "Confirm operational qualification is complete." },
        },
        {
          id: "s5",
          type: "approval",
          kind: "approval",
          label: "PQ (Performance Qualification)",
          config: { approverDepartment: "engineering", message: "Confirm performance qualification is complete." },
        },
        {
          id: "s6",
          type: "approval",
          kind: "approval",
          label: "Deviations recorded/resolved",
          config: { approverDepartment: "quality", message: "Record any deviations and confirm they are resolved before the report is written." },
        },
        {
          id: "s7n",
          type: "action",
          kind: "notify_department",
          label: "Validation Reports folder",
          config: {
            department: "quality",
            subject: "Validation report is ready to file",
            body: "Write the validation report in the Validation Reports folder: /folders/validation-reports",
          },
        },
        {
          id: "s7",
          type: "approval",
          kind: "approval",
          label: "Validation Report written",
          config: {
            approverDepartment: "quality",
            message: "Write the validation report in the Validation Reports folder (/folders/validation-reports), then approve this step.",
            documentFolder: "/folders/validation-reports",
          },
        },
        {
          id: "s8",
          type: "approval",
          kind: "approval",
          label: "Final review & approval/release",
          config: { approverRole: "quality_manager", approverDepartment: "quality", message: "Final review. Approve to release the validation." },
        },
        { id: "end", type: "end", kind: "end", label: "Released", config: {} },
      ],
      edges: [
        { from: "t1", to: "s1" },
        { from: "s1", to: "s2", branch: "approved" },
        { from: "s2", to: "s3", branch: "approved" },
        { from: "s3", to: "s4", branch: "approved" },
        { from: "s4", to: "s5", branch: "approved" },
        { from: "s5", to: "s6", branch: "approved" },
        { from: "s6", to: "s7n", branch: "approved" },
        { from: "s7n", to: "s7" },
        { from: "s7", to: "s8", branch: "approved" },
        { from: "s8", to: "end", branch: "approved" },
      ],
    },
  },
];
