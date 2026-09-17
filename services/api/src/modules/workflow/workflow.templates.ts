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
 * the tenant explicitly reviews and saves it as their own workflow_definitions
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
];
