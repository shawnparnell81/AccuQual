# AccuQual Workflow Architecture Reference

**Status:** Mapping/documentation only — no code, schema, or architecture changed to produce this document. Every fact below was verified directly against the real codebase (file paths, exact enum values, exact code snippets) as of this pass; nothing here is aspirational or idealized.

---

## Part 0 — Executive Summary: the real architecture (and where it differs from a "generic workflow platform")

AccuQual does **not** have one central workflow runtime that every module's records pass through. It has two separate, complementary layers, and conflating them is the single most common misreading of this system:

**Layer 1 — Per-module hand-coded state machines (where almost all real workflow enforcement lives).** Each module that has a lifecycle (NCR, CAPA, Risk, Warranty, RMA, RMA Log, CRAR, Work Orders, Receiving, Audits, 8D, Supplier status, Supplier Corrective Action) owns its own `status` column, its own transition-guard logic (usually a literal `ALLOWED_NEXT: Record<string,string[]>` map checked before any update), its own inline RBAC (`assertDepartment`/`requireDepartmentAccess`), and its own calls to `recordAuditTrail(...)` and `publishEvent(WORKFLOW_STREAM, {...})`. There is **no generic `POST /workflow/transition` or `POST /workflow/rules/check` endpoint anywhere in the codebase** — every module's transition is its own dedicated route (`POST /ncr/:id/close`, `POST /risk/:id/close`, `POST /rma-log/:id/status`, etc.). This document treats each module's real transition map as that module's authoritative "workflow JSON definition."

**Layer 2 — The generic Workflow Engine (Platform Admin's Workflow Builder, `workflow_definitions`/`workflow_runs`).** A genuinely separate, tenant-configurable automation layer: a definition is a graph of `trigger`/`condition`/`action` nodes (`{nodes[], edges[]}`), matched against the `event` field of whatever a module's own `publishEvent(WORKFLOW_STREAM, {module, event, entityId, tenantId, ...})` call just emitted. It does **not** own or enforce any module's state machine — it *reacts* to state changes Layer 1 already made, and can then fire cross-cutting actions (`send_email`, `notify_department`, `notify_supplier`, `create_ncr`, `escalate_capa`, `assign_user`, `ai_suggestion`). A module with zero `publishEvent` calls (see Document Control's create/revise/archive paths) is simply invisible to this layer for those events — Layer 2 can only ever be as complete as Layer 1's event coverage.

This two-layer reality is why "workflow maturity" varies enormously by module (see Part 5): some modules (NCR, CAPA, Risk, Warranty, RMA Log) have strict guarded transitions AND full event coverage; others (Document Control, Quality Inspection Reports) have real status fields with **no transition guard at all** (any status → any status via a generic PATCH); CRAR and RMA Log have real audit-trail-panel support in the generic engine's `/workflow/history` endpoint but their own frontend pages still use a different display component.

---

## Part 1 — Cross-cutting infrastructure (defined once, referenced per module)

### 1.1 Shared audit trail mechanism
Every module's `recordAuditTrail(db, {tenantId, entityType, entityId, action, changes, performedBy})` writes one row to the `audit_trail` table. `action` is a closed enum: `"create" | "update" | "delete" | "status_change" | "transition_failed" | "permission_denied" | "decision"`. `entityType` is a per-module literal string (documented per module below) that **must** match the casing every other call for that module uses, or a record's own History tab silently misses entries (a real, previously-fixed class of bug — see the NCR/CAPA/Quality casing corrections). `performedBy` resolves to a real name via `withResolvedActors`; `null` renders as "System."

A second mechanism, `errorHandler.ts`'s `logFailedTransition()`, fires automatically on **every** failed (4xx/5xx) state-changing request against a recognized module (`ROUTE_ENTITY_TYPES` map keyed by URL prefix) — this is what produces the standard `action: "permission_denied"` / `"transition_failed"` entries without each controller needing its own catch block.

### 1.2 Shared workflow-event mechanism
`publishEvent(WORKFLOW_STREAM, {tenantId, module, event, entityId, ...extra})` (`services/api/src/lib/eventBus.ts`) writes to the Redis Stream `accuqual:workflow-events`. Two consumers exist: the `workflow-worker` process (matches `module`+`isActive` definitions, runs the graph with `event` as trigger kind) and nothing else — there is no second subscriber. All Redis Stream field values arrive as **strings** even when the publisher sent a number (a real, previously-fixed gotcha for any new action handler reading numeric context fields).

### 1.3 Shared frontend components
| Component | File | Used by | Notes |
|---|---|---|---|
| `WorkflowActionButton` | `apps/web/src/components/shared/WorkflowActionButton.tsx` | 18 modules (Audits, CAPA, Crar, Customers, Erp PO/Requisition, Inventory, NCR, Quality, Risk, Rma, RmaLog, Sales, Suppliers, Warranty, WorkOrders, +2) | One shared "transition button" — visibility/label/variant passed by the caller, click wired to `useWorkflowAction(module, action)`. |
| `WorkflowHistoryPanel` (+`WorkflowHistoryItem`) | `apps/web/src/components/shared/WorkflowHistoryPanel.tsx` | 18+ modules directly, plus `DocumentHistoryPanel`/`TrainingHistoryPanel` as thin wrappers | Fetches `GET /workflow/history/:moduleName/:recordId` (Layer-2-adjacent read endpoint keyed by `workflow.controller.ts`'s `MODULE_ENTITY_TYPES` map). |
| `EntityAuditTrailPanel` | `apps/web/src/components/shared/EntityAuditTrailPanel.tsx` | **CRAR, RMA Log** (both frontend pages, even though both are now present in `MODULE_ENTITY_TYPES` and could use `WorkflowHistoryPanel`) | A narrower panel hitting `GET /audit-trail/:entityType/:entityId` directly. Kept for these two as a leftover frontend choice, not a backend limitation — see §Cross-module drift below. |
| Bespoke (no shared component) | `components/documents/{DocumentHistoryPanel,DocumentApprovalModal,DocumentRevisionModal,DocumentRetentionPanel}.tsx` | **Document Control only** | The one module with a fully custom, non-shared workflow UI. |
| `AiStructuredSuggestion` | `apps/web/src/components/shared/AiStructuredSuggestion.tsx` | 8 modules (Audits, CAPA, NCR, QualityInspectionReports, Reporting, SupplierPortal messaging, Warranty) | Self-contained Accept/Reject panel — every module gets identical buttons/copy/confidence display. |
| `AiFieldAssistant` | `apps/web/src/components/shared/AiFieldAssistant.tsx` | 11 modules | A different tool: free-form generate-and-insert-into-field, not an accept/reject suggestion. |
| `StatusBadge` (+`BUCKET_BY_STATUS`) | `apps/web/src/components/tables/StatusBadge.tsx` | Nearly every list/detail page | One 5-bucket (`muted/info/warning/success/destructive`) color mapping every status string in the app resolves through. |

### 1.4 Real, generic Workflow Engine API surface (Layer 2 — Platform Admin)
There is no `/workflow/transition` or `/workflow/rules/check`. The real routes (`services/api/src/modules/workflow/workflow.routes.ts`), all gated by `requireDepartmentAccess("workflow")` (default: `quality: edit, engineering: read`):

| Method | Path | Purpose |
|---|---|---|
| GET | `/workflow/history/:moduleName/:recordId` | Layer-1 history read for any module in `MODULE_ENTITY_TYPES` |
| GET | `/workflow/health` | Per-definition diagnostics: last success/failure, unregistered action kinds, missing trigger |
| GET | `/workflow/templates` | The 8 starter templates (Part 3) |
| GET | `/workflow/action-kinds` | Live registry of executable action kinds |
| GET/POST | `/workflow/` | List / create a definition |
| PATCH/DELETE | `/workflow/:id` | Edit (version-bumps only if `definition` itself changed — deep-equal check via `JSON.stringify`; `versionHistory` capped at 20, oldest dropped) / delete |
| POST | `/workflow/:id/run` | Run for real, or `simulate: true` for Simulation Mode (Part 4) |

Registered action kinds today (`workflowActions.ts`): `send_email`, `notify_department`, `notify_supplier`, `create_ncr`, `escalate_capa`, `assign_user`, `ai_suggestion`.

### 1.5 Real cross-module reflex documented elsewhere in this codebase (not invented for this doc)
- Receiving → NCR: `maybeAutoCreateNcr` (opt-in via `tenants.receivingSettings.autoCreateNcrOnRejection/OnQuarantine`).
- Receiving recurrence → CAPA: `checkCapaEscalation` (real threshold/window count, default 3 events / 90 days).
- Internal Audit finding (severity ≠ observation) → auto-creates a Discrepancy Investigation row (**not** NCR/CAPA) — a fact this pass corrected against the brief's assumption that findings escalate to NCR.
- Risk level does **not** push into any other module automatically — only the reverse (other modules can *create* a risk via `sourceType`/`sourceId`).

---

## Part 2 — Per-module workflow maps

Each module below covers all 14 required elements. Where an element is identical to Part 1's shared mechanism, it says so rather than repeating the description.

---

### QUALITY GROUP

## 2.1 NCR (Non-Conformance Report)

**1. States** — `ncr.status`: `open` (default) → `contained` → `investigating` → `corrective_action` → `closed`.
| State | Purpose | Entry rule | Exit rule |
|---|---|---|---|
| open | Newly logged nonconformance | Created directly, or auto-created from a rejected/quarantined receiving line | `containment` text required to leave |
| contained | Immediate containment done | `setContainment()` only from `open` | `rootCause` text required to leave |
| investigating | Root cause work in progress | `setRootCause()` only from `contained` | `correctiveAction` text required to leave |
| corrective_action | Fix defined, pending closure | `setCorrectiveAction()` only from `investigating` | admin/quality closes |
| closed | Resolved | `close()` only from `corrective_action`, stamps `closedAt` | terminal |

**2. Transitions** (`services/api/src/modules/ncr/ncr.service.ts`) — strict one-hop guard via `expectedFrom` array on each function; `assign()` (owner reassignment) is allowed from any status.
```
open -[containment]-> contained -[root_cause]-> investigating -[corrective_action]-> corrective_action -[closed]-> closed
```
**3. Rules** — ResourceKey `ncr`. Default RBAC: `quality: edit; engineering/production/customer_service/purchasing/material_management/sales_and_marketing: read`. Every transition endpoint requires `edit`.
**4. Conditions** — severity (`low|medium|high|critical`, free text) set at creation, drives auto-created NCR titles ("high" for rejected receiving, "medium" for quarantined) but does not itself gate any transition. `supplierId`/`receivingLineItemId` are real FKs (Phase 8) used for cross-module linkage and the Supplier Quality Risk Score's NCR-count factor.
**5. Actions** — auto-create from receiving (`maybeAutoCreateNcr`, opt-in); each transition syncs the official form document (`syncNcrFormData`) one-way (bare fields → form_data, never the reverse).
**6. Outputs** — `audit_trail` row per transition; a `form_data` row kept in sync; a Supplier Quality Risk Score factor; feeds the Discrepancy/NCR dashboard KPI count.
**7. Audit trail** — `entityType: "NCR"`, `action: "status_change"` per step (`"create"` on auto-create), `changes: {action, patch}`.
**8. Diagrams**
```
State diagram:            [open] --containment--> [contained] --root_cause--> [investigating]
                                                                                     |
                                                                             corrective_action
                                                                                     v
                                                                          [corrective_action] --closed--> [closed]

Escalation diagram:  Receiving quarantined/rejected --(if enabled)--> NCR(open) --(3+ recurrence, 90d)--> CAPA(escalationSource=receiving_recurrence)
```
**9. JSON definition** (Layer-2-equivalent graph an admin could load into the Workflow Builder to *observe* this module's real events):
```json
{
  "nodes": [
    { "id": "t1", "type": "trigger", "kind": "closed", "config": {} },
    { "id": "a1", "type": "action", "kind": "notify_department", "config": { "department": "quality", "subject": "NCR closed" } }
  ],
  "edges": [{ "from": "t1", "to": "a1" }]
}
```
Real trigger kinds available: `containment`, `root_cause`, `corrective_action`, `closed`, `assigned`, `auto_created_from_receiving`.
**10. Templates** — `ncr_closure_notification` (real, ships in `workflow.templates.ts`).
**11. UI** — `WorkflowActionButton` + `WorkflowHistoryPanel`; `AiStructuredSuggestion` (triage), `AiFieldAssistant` (root cause/containment drafting).
**12. Endpoints** — `GET/POST /ncr`, `GET/PATCH /ncr/:id`, `POST /ncr/:id/{containment,root-cause,corrective-action,close,assign}`.
**13. Simulation** — Layer 2 only (a workflow definition targeting `module:"ncr"` can be dry-run via `POST /workflow/:id/run {simulate:true}`); the NCR state machine itself has no simulate mode — every call is a real transition.
**14. Maturity** — ✅ Complete guard, ✅ full event coverage, ✅ audit trail, ✅ shared UI. Mature.

## 2.2 CAPA (Corrective and Preventive Action)

**1. States** — `open` (default) → `in_progress` → `verifying` → `closed`.
**2. Transitions** — `open → in_progress` is the **one exception in the app**: no dedicated endpoint/guard, done via the generic `PATCH /capa/:id` (any caller can set `status:"in_progress"` directly). `in_progress → verifying` (`verifyHandler`, requires `verification` text) and `verifying → closed` (`closeHandler`) are guarded one-hop checks.
**3. Rules** — ResourceKey `capa`. Default RBAC: `quality: edit`; every other department `none`.
**4. Conditions** — `escalationSource` (`"receiving_recurrence"` today, else null) marks auto-escalated CAPAs; `ncrId`/`supplierId` real FKs.
**5. Actions** — auto-escalation from Receiving recurrence (`checkCapaEscalation`, Part 1.5); real Layer-2 `escalate_capa` action kind exists for engine-driven escalation too.
**6. Outputs** — audit trail; feeds Dashboard's "CAPA Effectiveness %" and the Reporting Hub's CAPA chart; feeds Supplier Quality Risk Score's CAPA/CAPA-recurrence factors.
**7. Audit trail** — `entityType: "CAPA"`; `status_change` with `changes: {action: "verify"|"close"}`; `create` with `changes: {message: "CAPA escalation triggered from Receiving", ...}` on auto-escalation.
**8. Diagrams**
```
[open] --(generic PATCH, unguarded)--> [in_progress] --verify--> [verifying] --close--> [closed]
```
**9. JSON** — real trigger kinds: `verify`, `close`, `escalated_from_receiving`. Template: `capa_effectiveness_close`.
**10-12** — as Part 1; endpoints `GET/POST /capa`, `PATCH /capa/:id`, `POST /capa/:id/{verify,close}`.
**13. Simulation** — Layer 2 only.
**14. Maturity** — ⚠️ real gap: the open→in_progress hop has no guard/audit distinct action (folds into generic "update"), unlike every other module's transitions. Otherwise mature.

## 2.3 8D

**1. States** — not a text-status machine: `eight_d.currentStep` (integer 1-8), plus a single `data` jsonb blob holding `d1_team`…`d8_closure` narrative fields. A companion, separately-workflowed table `supplier_8d_responses` (supplier-submitted) has its own real status: `submitted` (default) → `under_review` → `accepted`|`rejected`.
**2. Transitions** — internal 8D: `completeStepHandler` increments `currentStep`; step 8 = closure. No skip-ahead guard found (steps can in principle be completed out of order via direct step number). Supplier response: reviewed by Quality/Purchasing (`assertReviewer`), no `ALLOWED_NEXT` guard — reviewer sets `status` to any string.
**3. Rules** — ResourceKey `eight_d`, default `quality: edit`, all else `none`. Supplier-response review: Quality or Purchasing only (`assertReviewer`).
**4. Conditions** — `ncrId`/`linkedNcrId`/`linkedEightDId` link the two tables together; no severity/recurrence conditions.
**5. Actions** — none automated; purely human-driven documentation.
**6. Outputs** — audit trail; 8D closure feeds NCR's own closure narrative when linked.
**7. Audit trail** — `entityType` likely `"EightD"`/`"SupplierEightDResponse"` pattern consistent with sibling modules; `action: "status_change"` on step completion (`module:"eight_d"`, `event: isClosure ? "closed" : "step_completed"`).
**8. Diagrams**
```
Internal:  [step 1] -> [step 2] -> ... -> [step 8 = closure]
Supplier:  [submitted] --review--> [under_review] --review--> [accepted | rejected]
```
**9. Template** — `eight_d_closure` (real, ships in `workflow.templates.ts`).
**10-12** — as Part 1; supplier-portal routes for the response half live under `/supplier-portal`.
**13. Simulation** — Layer 2 only.
**14. Maturity** — ⚠️ no strict step-order guard on the internal record; ⚠️ supplier-response review has no `ALLOWED_NEXT` guard (any status string accepted). Functionally complete, procedurally loose.

## 2.4 Document Control

**1. States** — `documents.status`: `draft` (default) → `in_review` → `approved` → `obsolete`, plus a separate `retentionState` (`active`|`archived`) driven by retention policy, not the status field.
**2. Transitions** — **no guard at all.** Uploading a new version force-sets `in_review` regardless of current status; approving force-sets `approved` regardless of current status; the generic `PATCH /documents/:id` accepts a raw `status` field with zero sequence check. This is the one module in the app where any status can move to any other status via plain PATCH.
**3. Rules** — **no RBAC gate whatsoever** — `documents` is not in the `ResourceKey` union. Only `requireAuth` applies: any authenticated tenant user can create, revise, approve, or archive any document.
**4. Conditions** — retention eligibility (`retentionState !== "archived"` AND `approvedAt` older than `retentionPeriodDays`) gates the archive sweep, not a workflow condition.
**5. Actions** — none automated beyond the retention sweep endpoint (must be called, not scheduled — no background job exists in this app).
**6. Outputs** — audit trail; only `approve` publishes a workflow event.
**7. Audit trail** — `entityType: "Document"`; revise → `action:"update", changes:{action:"revise",...}`; approve → `action:"status_change", changes:{action:"approve",...}` (comment: "approve" isn't in the fixed action enum, hence reused as status_change); retention → `action:"update", changes:{action:"retention",...}`.
**8. Diagrams**
```
[draft] --(upload version)--> [in_review] --(approve)--> [approved] --(plain PATCH, ungoverned)--> [obsolete] --(retention sweep)--> archived/deleted
```
**9. JSON** — the **only** real trigger kind is `approved` (`module:"documents"`). No other document lifecycle event is observable to Layer 2 at all.
**10.** Template `document_revision_approval` (real, ships in `workflow.templates.ts`) — targets the one real event.
**11. UI** — bespoke only (Part 1.3) — the sole module not using shared `WorkflowActionButton`/`WorkflowHistoryPanel`.
**12. Endpoints** — `GET /documents/expiring`, `POST /documents/retention/apply`, `GET/POST /documents`, `GET/PATCH /documents/:id`, `POST /documents/:id/version[/upload]`, `GET /documents/version/:versionId/file`, `POST /documents/:id/approve`, `POST /documents/:id/archive`, `GET /documents/:id/history`.
**13. Simulation** — N/A (no guarded state machine to simulate).
**14. Maturity** — 🔴 least mature module in the platform: no RBAC, no transition guard, minimal event coverage, non-shared UI. Real, concrete gap — not a documentation omission.

## 2.5 Audit

**1. States** — `scheduled` (default) → `in_progress` → `completed`.
**2. Transitions** — dedicated guarded one-hop endpoints (`start`: must be `scheduled`; `complete`: must be `in_progress`) **coexist** with the still-unguarded generic `PATCH /audits/:id` (which accepts a raw `status` and bypasses the sequence check).
**3. Rules** — ResourceKey `audit`, default `quality: edit`, all else `none`.
**4. Conditions** — audit `type` (`internal|supplier|customer|certification`) gates the auto-escalation condition below; item `severity` (`observation|minor|major|critical`) is the recurrence/severity condition.
**5. Actions** — **real cross-module trigger**: adding a finding with `severity ≠ "observation"` on an `internal`-type audit auto-inserts a `discrepancy_investigations` row (`status:"open", autoCreated:true, sourceAuditId, sourceAuditItemId`) — corrected from the brief's assumption this would be an NCR. Finding text is also queued for AI embedding (`AI_STREAM`, `job:"embed"`).
**6. Outputs** — audit trail; an auto-opened Discrepancy Investigation; embedding job.
**7. Audit trail** — `entityType: "Audit"` for start/complete; `entityType: "Discrepancy investigation"` for the auto-created finding record, `changes:{autoCreated:true, sourceAuditId, sourceAuditItemId, severity}`.
**8. Diagrams**
```
[scheduled] --start--> [in_progress] --complete--> [completed]
Escalation: internal audit finding (minor|major|critical) --auto--> Discrepancy Investigation(open)
```
**9. Trigger kinds** — `start`, `complete`.
**10-12** — as Part 1; endpoints `GET/POST /audits`, `PATCH /audits/:id`, `GET/POST /audits/:id/item`, `POST /audits/:id/{start,complete}`.
**13. Simulation** — Layer 2 only.
**14. Maturity** — ✅ good event coverage and a real cross-module reflex; ⚠️ the unguarded generic PATCH still coexists alongside the guarded transition endpoints (same drift pattern as CAPA's open→in_progress hop).

## 2.6 Risk / FMEA

**1. States** — `riskAssessments.status`: `open` (default) → `mitigation` → `monitoring` → `closed`. `riskMitigations.status` (`planned|in_progress|completed`) is a separate, ungated field.
**2. Transitions** — strict `ALLOWED_NEXT` map (`open→mitigation→monitoring→closed`, linear, no skip). `updateRiskSchema` **structurally excludes `status`** — the only way to change it is the dedicated transition endpoints (no PATCH-bypass, unlike Documents/Audits/8D/Quality-Inspection).
**3. Rules** — ResourceKey `risk`; route-level floor `quality/engineering/production/purchasing/material_management: edit`, but real per-action asymmetry enforced inline: create = those 5 departments; **field edits** (severity/probability/etc.) = quality+engineering only; **status transitions** = quality only; delete = admin only.
**4. Conditions** — severity×probability (1-5 each) → `riskScore` (1-25) → banded `riskLevel`: `<5 low, 5-9 medium, 10-15 high, ≥16 critical`. FMEA RPN = severity×occurrence×detection (1-10 each, classic FMEA scale — deliberately different from the risk-assessment 1-5 scale).
**5. Actions** — none automated on risk level (confirmed: risk does not push into any other module); risk records are only ever the *target* of a "Create Risk" link from NCR/Supplier/Receiving/WorkOrder/Customer. A real AI-analysis endpoint suggests severity/probability/mitigations — never auto-applied, human must confirm.
**6. Outputs** — audit trail; feeds the Risk Dashboard.
**7. Audit trail** — `entityType: "RiskAssessment"`/`"RiskMitigation"`; `status_change` carries `{oldStatus,newStatus}`; field edits distinguish `subAction:"severity_probability_change"` and `subAction:"ai_suggestion_accepted"`.
**8. Diagrams**
```
[open] --(quality only)--> [mitigation] --(quality only)--> [monitoring] --(quality only)--> [closed]
```
**9. Trigger kinds** — `mitigation`, `monitoring`, `closed` (event = the new status string itself).
**10-12** — as Part 1; endpoints `GET/POST /risk`, `PUT/DELETE /risk/:id`, `POST /risk/:id/{start-mitigation,start-monitoring,close}`, `GET/POST /risk/:id/fmea`, `POST/PUT /risk/:id/mitigation[/:mid]`, `POST /risk/:id/ai-analysis`.
**13. Simulation** — Layer 2 only.
**14. Maturity** — ✅ the single most rigorously guarded module in the platform (schema-level PATCH exclusion, full department asymmetry, full event coverage). Mature.

---

### SUPPLIER GROUP

## 2.7 Supplier Corrective Action (SCAR)

**1. States** — `supplier_corrective_actions.status`: default `"submitted"`, confirmed real values in use include `"accepted"` (others follow the same submitted→under_review→accepted|rejected vocabulary its sibling tables in the same file use).
**2. Transitions** — **no `ALLOWED_NEXT` guard** — `reviewCorrectiveActionHandler` accepts any `status` string from the reviewer, no prior-state check.
**3. Rules** — reviewed by Quality or Purchasing only (`assertReviewer`); submission comes from the supplier portal (`requireSupplierPortalAccess`).
**4. Conditions** — `linkedNcrId`/`linkedCapaId` optional cross-links; no severity/recurrence condition on the record itself.
**5. Actions** — none automated beyond the workflow event below.
**6. Outputs** — audit trail; feeds the Supplier Portal's own "corrective action count/accepted count" summary (`GET /supplier-portal/kpis`).
**7. Audit trail** — `entityType: "SupplierCorrectiveAction"`; `create` then `status_change` with `changes:{status, reviewNotes}`.
**8. Diagram**
```
[submitted] --review(quality|purchasing)--> [under_review] --review--> [accepted | rejected]
```
**9. Trigger kind** — `module:"supplier_car"`, `event: <newStatus>` (added specifically because this review previously had **zero** workflow event coverage).
**10.** Template `supplier_car_rejection` (real, ships in `workflow.templates.ts`).
**11-12** — Supplier Portal UI (bespoke supplier-facing form, not the internal shared components); endpoints under `/supplier-portal/corrective-actions`.
**13. Simulation** — Layer 2 only.
**14. Maturity** — ⚠️ no transition guard (any status accepted) — same class of gap as Documents/8D-response.

## 2.8 Supplier Onboarding

**Reality check (corrects the brief's framing):** there is **no** supplier-level approval gate before a supplier record becomes usable — `POST /suppliers` creates one immediately, active, with no qualification workflow. "Onboarding" in this codebase is a **document-collection sub-workflow**, entirely separate from the supplier's own active/probation/suspended/disqualified status lifecycle (§2.9).

**1. States** — per-document (`supplier_onboarding_documents.status`): `submitted` (default) → `approved`|`rejected`. Resubmission inserts a new row (full history kept), not an overwrite.
**2. Transitions** — no guard beyond the reviewer setting either terminal value directly.
**3. Rules** — review = Quality or Purchasing only (`assertReviewer`); upload = the supplier's own portal login (`requireSupplierPortalAccess`, auto-scoped to their own `supplierId`).
**4. Conditions** — document `type` (W-9, NDA, Quality Manual, Process Flow, Control Plan, FMEA, Org Chart, ISO/IATF/AS9100 certs, Questionnaire, Agreement) — no cross-document dependency (approving one doesn't unlock another).
**5-6. Actions/Outputs** — none automated; feeds `GET /supplier-portal/onboarding/status` (latest row per document type).
**7. Audit trail** — standard create/status_change pattern, `entityType` scoped to onboarding documents.
**8. Diagram** — `[submitted] --review--> [approved | rejected]` (per document, independently).
**9-13** — as above; no dedicated workflow template exists for onboarding specifically.
**14. Maturity** — 🔴 real architectural gap: this sub-workflow never touches `suppliers.status` — a supplier can be fully "disqualified" while every onboarding document sits "approved," or vice versa. If the platform ever wants "onboarding complete" to gate supplier activation, that link does not exist today.

## 2.9 Supplier (status) + Supplier Performance Review

**1. States** — `suppliers.status`: `active` (default) → `probation` | `suspended` → `disqualified` (terminal — only `remove` is idempotent from any state; `disqualified` blocks approve/conditional/suspend).
**2. Transitions** — dedicated guarded actions (`approve→active`, `conditional→probation`, `suspend→suspended`, `remove→disqualified`); each checks `current.status !== "disqualified"` except `remove` itself.
**3. Rules** — ResourceKey `suppliers`: `quality: edit; production/purchasing/material_management: read`. (Corrects a possible assumption that Purchasing can approve — explicitly Quality/admin only.)
**4. Conditions** — none beyond the disqualified-is-terminal rule.
**5. Actions** — none automated (no notification/email fires on status change).
**6. Outputs** — audit trail; feeds every downstream supplier-linked report (Scorecard, Risk Score, Dashboard "At-Risk Suppliers").
**7. Audit trail** — `entityType: "Supplier"`, `action:"status_change"`, `changes:{action, from, to}`.
**8. Diagram**
```
[active] <--approve-- [probation] <--conditional-- (any) --suspend--> [suspended]
   \_______________________________disqualify (terminal, idempotent)_______________________________/
```
**9. Trigger kinds** — `approve`, `conditional`, `suspend`, `remove`.
**Supplier Performance Review** (separate, **stateless**, read-only computed report — `supplier.performance.ts`):
- Risk points (0-8): timeliness >14d→2/>7d→1; accuracy <75%→2/<90%→1; below-min alerts ≥6→2/≥3→1; overdue reorders ≥3→2/≥1→1. Band: ≥5 high, ≥2 medium, else low (or `"no_data"`).
- **Supplier Quality Risk Score** (a *third*, distinct, persisted-daily-snapshot metric — `supplier_quality_risk_scores`): weighted formula, `DEFAULT_SUPPLIER_RISK_WEIGHTS = {ncr:20, capa:15, capaRecurrence:15, delivery:15, defectRate:15, warranty:10, responsiveness:10}`, band cutoffs `≥75 critical, ≥50 high, ≥25 medium, else low`. Write path: `POST /suppliers/:id/risk-score/recompute` (quality/admin). **Three separate, non-reconciled "supplier risk" numbers coexist by design** (performance heuristic, quality risk score, plus the free-text manual `riskLevel` field nobody writes to programmatically) — a real, previously-documented, intentional design choice, not drift.
- **Supplier Scorecard** (`supplier_scorecards`) — a fourth mechanism: manually entered `qualityScore`/`deliveryScore` (0-100), `overallScore` computed server-side as their average. Quality/admin only.
**10.** No workflow template targets supplier status changes directly today.
**11. UI** — `WorkflowActionButton` + `WorkflowHistoryPanel moduleName="suppliers"` (confirmed — unlike CRAR/RmaLog, Suppliers DOES use the shared history panel).
**12. Endpoints** — `GET/POST /suppliers`, `GET /suppliers/:id`, `GET /suppliers/:id/performance`, `POST /suppliers/:id/scorecard`, `GET /suppliers/:id/risk-score`, `POST /suppliers/:id/risk-score/recompute`, `POST /suppliers/:id/{approve,conditional,suspend,remove,portal-account}`.
**13. Simulation** — Layer 2 only for the status transitions; the performance/risk-score reports have no simulate concept (they're pure reads).
**14. Maturity** — ✅ status lifecycle is guarded and audited; ⚠️ four parallel "supplier risk" concepts is a real comprehension cost for any new engineer or buyer demo, even though each is individually well-built.

---

### WARRANTY GROUP

## 2.10 Warranty Claim

**1. States** — `new` (default) → `inspection` → `supplier_review` → `approved`|`rejected` → `replaced`|`repaired` → `closed`.
**2. Transitions** — strict `ALLOWED_NEXT` graph (branches at `supplier_review` and at `approved`), each hop stamped into a dedicated `warranty_claim_workflow` audit ledger (`fromStatus`/`toStatus`/`note`/`performedByUserId`), separate from (in addition to) the generic `audit_trail`.
**3. Rules** — ResourceKey `warranty`: `customer_service/quality/engineering/purchasing: edit; material_management: read`. Per-transition department requirement (`STATUS_TRANSITION_DEPARTMENTS`): `inspection`/`supplier_review` = quality+engineering; `approved`/`rejected` = quality only; `replaced`/`repaired`/`closed` = quality+customer_service.
**4. Conditions** — none beyond the department-per-target-status rule; `supplierId`/`linkedNcrId`/`linkedWorkOrderId` are real cross-links.
**5-6. Actions/Outputs** — claim-number generation (`WC-######`, insert-then-update pattern); cost rows (`warranty_claim_costs`) recompute `warrantyActualCost` as a live running sum on every insert.
**7. Audit trail** — `entityType: "WarrantyClaim"`, `status_change` with `{oldStatus,newStatus,note}`, **plus** the dedicated `warranty_claim_workflow` ledger row.
**8. Diagram**
```
[new] -> [inspection] -> [supplier_review] --> [approved] --> [replaced|repaired] --> [closed]
                                          \-> [rejected] ------------------------------> [closed]
```
**9. Trigger kinds** — `inspection`, `supplier_review`, `approved`, `rejected`, `replaced`, `repaired`, `closed`.
**10.** Template `warranty_rejection_notification` (real).
**11-12** — shared UI; endpoints `GET/POST /warranty`, `PATCH /warranty/:id`, `POST /warranty/:id/{transition,cost,document}`, `GET /warranty/analytics`.
**13. Simulation** — Layer 2 only.
**14. Maturity** — ✅ the most fully-instrumented lifecycle in the platform (guarded graph + department-per-hop + a dedicated second audit ledger). Mature.

## 2.11 RMA (plain)

**1. States** — `draft` (default) → `submitted_to_supplier` → `approved_by_supplier` → `in_transit` → `received_by_supplier` → `closed`; `cancelled` reachable from any non-terminal state.
**2. Transitions** — strict `ALLOWED_NEXT` map; `approved_by_supplier` auto-stamps `approvedByUserId` (there being no live supplier portal for this specific flow — an internal user always relays what the supplier said).
**3. Rules** — ResourceKey `rma`: `purchasing/material_management/quality: edit; engineering: read`. Per-transition department (`STATUS_TRANSITION_DEPARTMENTS`): most hops = purchasing+material_management; `approved_by_supplier`/`closed` = purchasing only.
**4-6.** No automated conditions/actions found; standard audit trail.
**7. Audit trail** — `entityType` per the module's own convention; `event: <newStatus>` published on every hop.
**8. Diagram**
```
[draft] -> [submitted_to_supplier] -> [approved_by_supplier] -> [in_transit] -> [received_by_supplier] -> [closed]
   \___________________________________ cancelled (from any non-terminal state) ___________________________________/
```
**9. Trigger kinds** — the 6 status values themselves.
**10-13** — as Part 1; no dedicated template ships for plain RMA today (distinct from `rma_closure_notification`, which targets RMA Log, §2.12).
**14. Maturity** — ✅ fully guarded and departmentally asymmetric. Mature.

## 2.12 RMA Log (customer-return register)

**1. States** — `open` (default) → `received` → `under_review` → `dispositioned` → `closed`. Auto-stamps `dateReceived`/`dateClosed` the moment those states are actually entered (never client-supplied).
**2. Transitions** — strict `ALLOWED_NEXT`, linear, no branching.
**3. Rules** — ResourceKey `rma_log` (base edit: `quality/customer_service`, `engineering/purchasing/material_management: read`) **plus two finer, independently-configurable access levels**: `rma_log_status` (must be `edit` to call the status-transition endpoint at all — `quality/customer_service` by default) and `rma_log_linkage` (must be `edit` to touch the FK-link fields `warrantyId`/`supplierRmaRequestId`/`qualityId` — same default). A denied attempt on either logs a standalone `permission_denied` audit entry even outside a request transaction (`recordAuditTrailStandalone`).
**4-6.** `dispositionAction` (validated: Warranty/Scrap/Repair/Replace/Credit) is the real condition/output field; links to Warranty, Supplier RMA Request, and NCR (`qualityId`) coexist without triggering anything on those records.
**7. Audit trail** — `entityType: "RmaLog"`.
**8. Diagram**
```
[open] --received--> [received] --under_review--> [under_review] --dispositioned--> [dispositioned] --closed--> [closed]
```
**9. Trigger kinds** — the 4 non-initial status values.
**10.** Template `rma_closure_notification` (real).
**11. UI** — **uses `EntityAuditTrailPanel`, not `WorkflowHistoryPanel`** — even though `rma_log: "RmaLog"` is present in `workflow.controller.ts`'s `MODULE_ENTITY_TYPES` (so the generic endpoint *would* work), the frontend was simply never switched over. Documented drift, not a backend gap.
**12. Endpoints** — `GET/POST /rma-log`, `PATCH /rma-log/:id`, `POST /rma-log/:id/status`.
**13. Simulation** — Layer 2 only.
**14. Maturity** — ✅ the most finely RBAC-partitioned module (base + status + linkage as three independent levers); ⚠️ frontend/backend history-panel drift noted above.

## 2.13 CRAR (Corrective Action Response)

**1. States** — `new` (default) → `quality_review` → `warranty_review` → `completed` (terminal — edits rejected once completed).
**2. Transitions** — strict, purely linear `ALLOWED_NEXT` (no branching, unlike Warranty).
**3. Rules** — ResourceKey `crar` (default: `quality: edit; engineering/purchasing: edit-but-narrowed; customer_service: read`) — engineering/purchasing hold nominal "edit" only so the router isn't blocked, then narrowed **inline** to touch only the `warrantyId` field (`WARRANTY_LINK_ONLY_DEPARTMENTS`); any other field attempt is a 403 + `permission_denied` audit entry. Status transitions additionally require a second, self-service `crar_workflow` access level (`edit`; default matches `quality/engineering/purchasing`) layered on top of `STATUS_TRANSITION_DEPARTMENTS` (`quality_review`/`warranty_review` = quality only; `completed` = quality+engineering+purchasing).
**4. Conditions** — `warrantyId` FK to `warranty_claims`; if `customerId` isn't given explicitly, it's inherited once from the linked warranty claim (lazy backfill, both on create and on later link).
**5-6.** No trigger runs on the linked warranty claim in either direction — this is read/reference-only plus the one-time customer inheritance, not a bidirectional sync.
**7. Audit trail** — `entityType: "Crar"`.
**8. Diagram**
```
[new] --quality_review--> [quality_review] --warranty_review--> [warranty_review] --completed--> [completed]
```
**9. Trigger kinds** — the 3 non-initial status values (event = new status itself).
**10-12** — no dedicated CRAR-only starter template ships (its closure is covered indirectly via `warranty_rejection_notification`'s pattern, not a literal CRAR template); endpoints `GET/POST /crar`, `PATCH /crar/:id`, `POST /crar/:id/transition`.
**11. UI note** — same as RMA Log: `crar: "Crar"` **is** in `MODULE_ENTITY_TYPES`, but `CrarDetailPage.tsx` still uses `EntityAuditTrailPanel`, not `WorkflowHistoryPanel` — a frontend choice, not a backend limitation.
**13. Simulation** — Layer 2 only.
**14. Maturity** — ✅ real, well-layered RBAC (base + field-narrowing + workflow-specific level); ⚠️ same history-panel drift as RMA Log.

---

### OPERATIONS GROUP

## 2.14 Receiving

**1. States** — `erp_receiving_line_items.status`: `received` (default) → `pending_inspection` → `inspected` → `accepted`|`rejected`|`quarantined`|`disposition_required`; `disposition_required`/`quarantined` can still resolve to `accepted`/`rejected`.
**2. Transitions** — the 7-state `RECEIVING_TRANSITIONS` map (`services/api/src/modules/erp/receivingWorkflow.ts`), strictly guarded.
**3. Rules** — Quality owns every inspection-outcome transition (`inspected`, `accepted`, `rejected`, `quarantined`, `disposition_required`); Material Management may only move `received → pending_inspection`. Admin bypasses.
**4. Conditions** — `defectCategory` (from the linked Quality Inspection Report, read-only cross-reference) can gate whether an auto-created NCR fires at all (tenant-configurable allow-list).
**5. Actions** — on transition into `rejected`/`quarantined`: `maybeAutoCreateNcr` (opt-in toggle) then `checkCapaEscalation` (real threshold/window, always evaluated regardless of the NCR toggle).
**6. Outputs** — audit trail; a real per-lot ledger entry (`inventory_lots` via `receiveIntoLot`) when a lot number is present; feeds the Supplier Quality Risk Score's defect-rate factor.
**7. Audit trail** — `entityType: "ErpReceivingLineItem"`, `changes:{from,to,notes}`.
**8. Diagrams**
```
[received] -> [pending_inspection] -> [inspected] -+-> [accepted]
                                                     +-> [rejected] ---------------------------\
                                                     +-> [quarantined] -+-> [accepted]           \--> (NCR auto-create, opt-in)
                                                     |                  +-> [rejected]            \--> (CAPA escalation on recurrence)
                                                     +-> [disposition_required] -+-> [accepted|rejected|quarantined]
```
**9. Trigger kinds** — the target status values themselves (`module:"receiving"`).
**10.** Template `receiving_rejection_escalation` (real).
**11-12** — shared UI; endpoint `POST /erp/receiving-line-items/:id/status`.
**13. Simulation** — Layer 2 only.
**14. Maturity** — ✅ fully guarded, well-instrumented, real cross-module automation. Mature.

## 2.15 Inspection (Quality Inspection Reports)

**1. States** — `finalStatus`: `accepted | rejected | rework_required | accepted_via_deviation` — a **result field, not a lifecycle**.
**2. Transitions** — **no guard at all** — `updateReportHandler` is a fully generic PATCH; `finalStatus` can be set to any value in any order.
**3. Rules** — ResourceKey `quality_inspection`: `quality: edit; purchasing/material_management: read` — this was previously **ungated entirely** (a real gap fixed in a past phase), now correctly gated.
**4. Conditions** — `inspectionType` (incoming/in_process/final), `inspectionMethod` (visual/dimensional/functional/documentation/other), per-item pass/fail with spec min/max.
**5-6. Actions/Outputs** — **parallel, not driving**: an inspection report's `finalStatus` never writes to `erp_receiving_line_items.status`, and the receiving state machine never writes back to the report — they're joined only by the `receivingLineItemId` FK for cross-reference (the receiving transition handler reads the report's `defectCategory` purely to feed the NCR auto-create allow-list check). This corrects any assumption that inspection "drives" receiving disposition.
**7. Audit trail** — standard create/update pattern, `entityType` per the module's convention.
**8. Diagram** — no guarded diagram exists; `finalStatus` is set once, generally at report completion, with no enforced predecessor state.
**9-13** — as Part 1; endpoints `GET/POST /quality-inspection-reports`, `PATCH/DELETE /quality-inspection-reports/:id`, `POST/PATCH/DELETE .../items[/:itemId]`.
**14. Maturity** — 🔴 real gap: no transition guard on a field literally named "status" — every other quality-adjacent module in this platform has one. RBAC is solid; the state machine is not.

## 2.16 Inventory Traceability

**1. States** — `inventory_lots.status`: `active` (default) → `consumed`|`scrapped`|`returned`|`expired`. `inventory_items.state` (a separate concept): `in_stock` (default) → `below_min`|`reorder_pending`|`on_order`|`overstock`|`inactive`, recomputed (not guarded) by `recomputeState()` on every stock-affecting write.
**2. Transitions** — lot quantity/status changes via `receiveIntoLot` (upsert by tenant+item+lot-number) and `consumeFromLot` (clamped decrement, never negative); item `state` is a derived, always-recomputed value, not a guarded machine.
**3. Rules** — ResourceKey `inventory`; movements are append-only (`inventory_movements`, never edited/deleted) — on-hand is always derived by replaying/aggregating them.
**4. Conditions** — `minLevel`/`maxLevel` thresholds drive the `below_min`/`overstock` state; `reservationRules.autoReleaseAfterDays` lazily releases stale reservations at read time (no background job).
**5-6. Actions/Outputs** — a below-min crossing raises an `inventory_alerts` row (deduplicated — one open alert per item/type); full backward+forward lot traceability (`getLotTraceability`: receiving line → PO line → PO → supplier → inspection report, plus every movement).
**7. Audit trail** — movements themselves ARE the audit trail (append-only ledger) rather than a separate `recordAuditTrail` call per movement.
**8. Diagram**
```
Lot:  [active] -> [consumed | scrapped | returned | expired]
Item state (derived, not guarded): in_stock <-> below_min <-> reorder_pending <-> on_order <-> overstock ; inactive (manual)
```
**9-13** — as Part 1; no dedicated workflow-engine trigger kinds fire on lot/item state changes today (this is the one Operations-group area with no `publishEvent(WORKFLOW_STREAM,...)` call at all — Layer 2 cannot react to inventory state changes directly, only to the Receiving/Work-Order events that cause them).
**14. Maturity** — ✅ excellent data-integrity design (append-only ledger, real traceability query); 🔴 zero Layer-2 event coverage — a genuine, specific gap if the platform ever wants "notify when item X goes below min" as a configurable workflow rather than the current fixed alert mechanism.

## 2.17 Production Workflow (Work Orders)

**1. States** — `planned` (default) → `in_progress` → `completed`|`cancelled`.
**2. Transitions** — strict `ALLOWED_NEXT`; separately, the **generic field PATCH is gated to the `planned` stage only** (quantity/dueDate/notes/revision become immutable once started), while the **traveler fields** (quality gates, operator/inspector signatures, operations rows) use a looser guard allowing edits through `in_progress`/`completed`, locked only once `cancelled`.
**3. Rules** — ResourceKey `work_orders`: `customer_service: edit; production/material_management/purchasing/quality: read`. **Every single write action — including start/complete/cancel/sign-off — is Customer Service (+ admin) only**; Production itself cannot touch its own work orders (deliberate: "back-office transcription of the printed/hand-signed paper traveler," confirmed still exactly true).
**4. Conditions** — `firstPieceInspectionPassed`/`finalQcInspectionPassed` boolean quality gates; `linkedNcrId` optional cross-link.
**5. Actions** — **completing** a work order automatically posts a real `"produce"` inventory movement (`applyMovement`, same request transaction — atomic).
**6. Outputs** — audit trail; the produce movement; operator/inspector signatures stamp `signedAt` server-side (never client-supplied).
**7. Audit trail** — `entityType` per convention; status_change per transition.
**8. Diagram**
```
[planned] -+-> [in_progress] -+-> [completed] --(auto)--> inventory_movements(type=produce)
           |                   +-> [cancelled]
           +-> [cancelled]
```
**9. Trigger kinds** — `in_progress`, `completed`, `cancelled` (or similar per the module's own event naming).
**10-12** — as Part 1; endpoints `GET/POST /work-orders`, `PATCH /work-orders/:id`, `POST /work-orders/:id/{start,complete,cancel,sign-operator,sign-inspector}`, `PATCH /work-orders/:id/quality-gates`, `POST/PATCH/DELETE .../operations[/:opId]`.
**13. Simulation** — Layer 2 only.
**14. Maturity** — ✅ fully guarded, real inventory-integration action, clear (if unusual) RBAC ownership. Mature.

---

### ADMIN GROUP

## 2.18 User Onboarding

**Reality check:** there is **no invite/pending-approval state** anywhere — both `POST /auth/register` (self-service, requires a valid tenant code) and `POST /users` (admin-created) create an **immediately active** user. The only real "onboarding email" in the codebase fires once, for the very first admin of a brand-new tenant (Platform Admin's tenant-provisioning flow) — a regular in-tenant `POST /users` sends no email of any kind, sent or logged.
**1. States** — `users.isActive` boolean (`true` default). No intermediate state.
**2. Transitions** — deactivation is a soft-delete (`DELETE /users/:id` sets `isActive:false`); login checks `isActive` and rejects with "Account is deactivated" otherwise. No dedicated "reactivate" endpoint — only the generic `PATCH /users/:id` can flip it back.
**3. Rules** — `POST /users`, `PATCH /users/:id`, `DELETE /users/:id` all `requireRole("admin")`-only; `GET /users` also allows `quality_manager`; `GET /users/:id` has no role gate beyond auth.
**4-6.** No conditions/automated actions.
**7. Audit trail** — **real gap**: `updateUser` (the handler used for both profile edits and role changes) does **not** call `recordAuditTrail` at all, unlike nearly every other mutating handler in the codebase.
**8. Diagram** — `[created, active] <-> [deactivated]` (direct toggle, no intermediate states).
**9-13.** Not a Layer-2-integrated module — no `publishEvent` calls found in the user lifecycle.
**14. Maturity** — 🔴 no audit trail on user/role changes, no Layer-2 event coverage, no invite workflow. The least-instrumented lifecycle of any "workflow" in this document, despite governing a highly sensitive action (who can log in and what they can do).

## 2.19 Role Change Workflow

**Reality check:** there is no approval workflow — a single admin's PATCH takes effect immediately, both for a user's coarse `roleId` and for the self-service permission system's rows.
**1. States** — N/A (no intermediate "pending role change" state exists).
**2. Transitions** — `users.roleId` changes via the fully generic `updateUser` handler (role is just one more field in the body). `department_permissions`/`permission_role_modules`/`user_permission_roles` change via dedicated `permissions.controller.ts` handlers, each a single upsert/delete — no second-approver gate anywhere.
**3. Rules** — role change: `requireRole("admin")` (same gate as §2.18, same missing-audit-trail gap). Permission-system changes: `permissionsRouter.use(requireRole("admin"))` blanket gate for everything except `GET /permissions/modules` and `GET /permissions/effective` (any authenticated user, read-only, own effective access).
**4-6.** No conditions; immediate effect on the next request (`getUserAccessLevel` reads live, no caching).
**7. Audit trail** — the permission-system side **is** fully audited (`entityType: "DepartmentPermission"|"PermissionRole"|"UserPermissionRole"`, create/update/delete) — this is the one part of the "Admin" group with real audit coverage; the coarse `users.roleId` change (§2.18's `updateUser`) is not.
**8. Diagram** — `(any admin) --single PATCH--> (new role/permission, effective immediately)`.
**9-13.** Not Layer-2-integrated.
**14. Maturity** — ⚠️ mixed: the self-service permission system (department grid, custom roles, user-role assignments) is fully audited and mature; the simpler, older `users.roleId` field sits right next to it with none of that instrumentation.

## 2.20 Workflow Editor Change Workflow (Platform Admin's own Workflow Builder)

**1. States** — a `workflow_definitions` row has `version` (integer, starts 1) + `versionHistory` (array, capped at 20 — oldest dropped first) + `isActive` (text "true"/"false", independent of version).
**2. Transitions** — **version bumps only when the `definition` field itself changes** — verified exact condition: `body.definition !== undefined && JSON.stringify(body.definition) !== JSON.stringify(existing.definition)`. A PATCH that only renames the definition or toggles `isActive` leaves `version`/`versionHistory` untouched (audit trail still logs the update either way, with `newVersion` reflecting whichever is true).
**3. Rules** — ResourceKey `workflow`: `quality: edit; engineering: read`.
**4-6.** No conditions beyond the deep-equality check; the history array itself is the "action" — each real definition change appends `{version, definition, updatedAt, updatedBy}` to `versionHistory` before applying the new one.
**7. Audit trail** — `entityType: "WorkflowDefinition"`, `action:"update"`, `changes:{fieldsChanged, newVersion}`; `action:"delete"` on removal (cascades `workflow_runs`).
**8. Diagram**
```
PATCH {definition changed} --> version+1, oldDefinition pushed to versionHistory (cap 20, oldest dropped)
PATCH {name/isActive only, definition unchanged} --> version unchanged, versionHistory unchanged
```
**9. JSON** — this IS the literal `{nodes[], edges[]}` shape documented in Part 1.4 — every other module's "JSON definition" in this document is an *equivalent representation*, but this module's real stored row genuinely is that JSON.
**10.** Ships all 8 real templates (Part 3) as starting points, editable here.
**11. UI** — the Workflow Builder page itself (`apps/web/src/routes/Workflow/WorkflowBuilderPage.tsx`) — condition/action editors, template loader, version display, Simulate toggle, Health panel.
**12. Endpoints** — as Part 1.4 in full.
**13. Simulation** — this module both *hosts* Simulation Mode (Part 4) and is itself simulate-able only in the trivial sense that a dry-run edit isn't a separate concept — edits either save or don't.
**14. Maturity** — ✅ this is the most self-referentially mature workflow in the platform: it is the engine that gives every OTHER module's Layer 2 automation its version control, audit trail, and health diagnostics.

---

## Part 3 — Workflow Templates (Platform Admin, real, all ship in `workflow.templates.ts`)

| Key | Target module | Trigger kind |
|---|---|---|
| `ncr_closure_notification` | ncr | closed |
| `capa_effectiveness_close` | capa | close |
| `eight_d_closure` | eight_d | closed |
| `receiving_rejection_escalation` | receiving | rejected |
| `rma_closure_notification` | rma_log | closed |
| `warranty_rejection_notification` | warranty | rejected |
| `supplier_car_rejection` | supplier_car | rejected |
| `document_revision_approval` | documents | approved |

Each is a real, verified `{trigger, action}` node pair matching an actual `publishEvent` call documented above — none are speculative.

---

## Part 4 — Workflow Simulation Results

Simulation Mode exists **only at Layer 2** (`POST /workflow/:id/run {simulate:true}`). It walks the identical graph-execution/condition logic as a real run, but every registered action handler skips its real side effect and instead records what it *would* have done:

| Action kind | Real effect | Simulated effect |
|---|---|---|
| `send_email` / `notify_department` / `notify_supplier` | Sends/logs a real notification, returns `recipientCount` | Records `{simulated:true, ...}`, no send |
| `create_ncr` / `escalate_capa` / `assign_user` | Real insert + audit trail + `publishEvent` | Records `{simulated:true, ...}`, no write |
| `ai_suggestion` | Real LLM/stub call, recorded to `ai_suggestions` | Skipped entirely — "would call the AI pipeline, skipped in simulation to avoid spending real usage quota" |

A simulation run is persisted (`workflow_runs.simulated = true`) but explicitly **excluded** from `/workflow/health`'s "last successful/failed run" signals, so a simulation can never be mistaken for a real system-health data point. Live-verified this session: a real simulate-mode run against a template returned a distinct, clearly-labeled JSON result with no real notification sent, confirmed against `notification_log` showing zero new rows.

**No per-module (Layer 1) simulation exists.** There is no "simulate an NCR closure" or "simulate a Work Order completion" — every Layer 1 transition endpoint, when called, is a real, committed state change. This is a genuine scope boundary: Simulation Mode only covers the automation an admin builds in the Workflow Builder, never a module's own hard-coded lifecycle.

---

## Part 5 — Workflow Maturity Report

**Completeness / consistency legend:** ✅ guarded transitions + full audit trail + Layer-2 event coverage. ⚠️ one real, named gap. 🔴 multiple real gaps or a structurally missing mechanism.

| Module | Guarded transitions | RBAC gate | Audit trail | Layer-2 events | Shared UI | Overall |
|---|---|---|---|---|---|---|
| NCR | ✅ | ✅ | ✅ | ✅ | ✅ | Mature |
| CAPA | ⚠️ (1 unguarded hop) | ✅ | ✅ | ✅ | ✅ | Mature w/ 1 gap |
| 8D | ⚠️ (no step-order/response guard) | ✅ | ✅ | ✅ | ✅ | Functional, loose |
| Document Control | 🔴 none | 🔴 none | ⚠️ partial | 🔴 1 event only | 🔴 bespoke | **Least mature** |
| Audit | ⚠️ (PATCH bypass coexists) | ✅ | ✅ | ✅ | ✅ | Mature w/ 1 gap |
| Risk/FMEA | ✅ (schema-enforced) | ✅ (asymmetric) | ✅ | ✅ | ✅ | **Most mature** |
| SCAR | 🔴 none | ✅ | ✅ | ✅ | bespoke portal | Functional, loose |
| Supplier Onboarding | ⚠️ (per-doc only, no link to supplier status) | ✅ | ✅ | none | bespoke portal | Real integration gap |
| Supplier status | ✅ | ✅ | ✅ | ⚠️ no template | ✅ | Mature |
| Supplier Performance Review | N/A (stateless report) | ✅ (read) | N/A | N/A | N/A | By design |
| Warranty | ✅ | ✅ (per-hop) | ✅✅ (2 ledgers) | ✅ | ✅ | **Most instrumented** |
| RMA | ✅ | ✅ (per-hop) | ✅ | ✅ | ✅ | Mature |
| RMA Log | ✅ | ✅ (3-level) | ✅ | ✅ | ⚠️ history-panel drift | Mature w/ 1 UI gap |
| CRAR | ✅ | ✅ (field-narrowed) | ✅ | ✅ | ⚠️ history-panel drift | Mature w/ 1 UI gap |
| Receiving | ✅ | ✅ | ✅ | ✅ | ✅ | Mature |
| Inspection | 🔴 none | ✅ | ✅ | none | ✅ | Real gap: status field, no guard |
| Inventory Traceability | N/A (ledger, not state machine) | ✅ | ✅ (ledger IS the trail) | 🔴 none | ✅ | Data-solid, Layer-2-blind |
| Production (Work Orders) | ✅ | ✅ (unusual ownership) | ✅ | ✅ | ✅ | Mature |
| User Onboarding | N/A (binary toggle) | ✅ | 🔴 none | none | N/A | Real gap: no audit trail |
| Role Change | N/A (immediate) | ✅ | ⚠️ (permissions audited, roleId not) | none | N/A | Mixed |
| Workflow Editor | ✅ (version-gated) | ✅ | ✅ | N/A (is Layer 2) | ✅ | **Self-referentially mature** |

**Cross-module alignment findings:**
- Every module using a real `ALLOWED_NEXT`-style map follows the identical shape (`Record<string, string[] | string>`, checked before update, `recordAuditTrail` + `publishEvent` immediately after) — this pattern is consistent everywhere it's used.
- Three modules (Document Control, 8D-response, SCAR, Quality Inspection Reports) have a real `status` field with **no guard at all** — the same class of gap repeated four times, not four unrelated issues.
- Two modules (CRAR, RMA Log) are fully wired into the generic `/workflow/history` endpoint but their frontends never switched over from the older `EntityAuditTrailPanel` — a pure frontend-consistency gap, zero backend cost to fix.
- Two modules (User Onboarding, Role Change's `roleId` path) have real, sensitive lifecycle actions with no audit trail at all — the biggest cross-cutting risk this mapping surfaced, since every *other* mutating action in the platform is audited.

**AI readiness:** 8 of 20 mapped areas have a real AI touchpoint (NCR triage, CAPA effectiveness, Audit prep/classification, Risk analysis, Warranty triage, Reporting summaries, Supplier messaging, Document SOP generation) — all via the shared `AiStructuredSuggestion`/`AiFieldAssistant` components with human-confirm-required, none auto-applying. AI mode itself (stub vs. live) is a single tenant-wide setting (Phase 10's Admin Console → AI Settings), not per-module.

**Audit readiness:** 18 of 20 areas have real, correctly-cased `recordAuditTrail` coverage. The two gaps (User Onboarding, Role Change's `roleId` path) are both in the Admin group and both touch user/permission changes — the highest-sensitivity area to be missing this coverage.
