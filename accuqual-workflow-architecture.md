# Workflow architecture

AccuQual does not run every record through one workflow runtime. Two layers sit next to each other.

**Module state machines.** NCR, CAPA, Risk, Warranty, RMA, RMA Log, CRAR, work orders, receiving, audits, 8D, and supplier status each own a `status` column, a transition check (usually an `ALLOWED_NEXT` map), their own department check, and their own `recordAuditTrail` and `publishEvent` calls. There is no `POST /workflow/transition`. A transition is a route on that module (`POST /ncr/:id/close`, `POST /risk/:id/close`, `POST /rma-log/:id/status`).

**Workflow Builder.** `workflow_definitions` / `workflow_runs` is a separate graph of `trigger`, `condition`, and `action` nodes (`{nodes, edges}`). The worker matches a definition to the `event` a module already published. It does not enforce that module's states. It can then `send_email`, `notify_department`, `notify_supplier`, `create_ncr`, `escalate_capa`, `assign_user`, `ai_suggestion`, or `erp_sync`. A write that never calls `publishEvent` is invisible to this layer.

## Shared pieces

`recordAuditTrail(db, {entityType, entityId, action, changes, performedBy})` appends one `audit_trail` row. `action` is `create | update | delete | status_change | transition_failed | permission_denied | decision`. `entityType` has to match the casing every other call for that module uses, or the History tab misses the row. `performedBy` resolves to a name; null renders as "System." `logFailedTransition()` in `errorHandler.ts` writes `permission_denied` / `transition_failed` for a failed state-changing request whose URL prefix is in `ROUTE_ENTITY_TYPES`, so controllers do not each catch that themselves.

`publishEvent(WORKFLOW_STREAM, {module, event, entityId, ...})` (`services/api/src/lib/eventBus.ts`) writes Redis stream `accuqual:workflow-events`. The workflow worker is the consumer. Stream values arrive as strings even when the publisher sent a number.

| Component | File | Notes |
|---|---|---|
| `WorkflowActionButton` | `apps/web/src/components/shared/WorkflowActionButton.tsx` | Caller passes label and visibility. Click goes to `useWorkflowAction`. |
| `WorkflowHistoryPanel` | `apps/web/src/components/shared/WorkflowHistoryPanel.tsx` | `GET /workflow/history/:moduleName/:recordId`, keyed by `MODULE_ENTITY_TYPES`. |
| `AiStructuredSuggestion` | `apps/web/src/components/shared/AiStructuredSuggestion.tsx` | Accept or reject. Nothing is written until Accept. |
| `AiFieldAssistant` | `apps/web/src/components/shared/AiFieldAssistant.tsx` | Free-text draft inserted into a field. |
| `StatusBadge` | `apps/web/src/components/tables/StatusBadge.tsx` | One color map for status strings. |

Document Control uses its own history and approval panels. Supplier portal reviews use the portal forms.

Workflow Builder routes (`workflow.routes.ts`), gated by `requireDepartmentAccess("workflow")` (default quality edit, engineering read):

| Method | Path | Purpose |
|---|---|---|
| GET | `/workflow/history/:moduleName/:recordId` | History for a module in `MODULE_ENTITY_TYPES` |
| GET | `/workflow/health` | Last success and failure, unregistered action kinds, missing trigger |
| GET | `/workflow/templates` | Starter templates |
| GET | `/workflow/action-kinds` | Registered action kinds |
| GET, POST | `/workflow/` | List or create a definition |
| PATCH, DELETE | `/workflow/:id` | Edit or delete. Version bumps only when `definition` changes (`JSON.stringify` compare). `versionHistory` keeps 20 entries. |
| POST | `/workflow/:id/run` | Run, or `simulate: true` |

Outside the builder, receiving can open an NCR (`maybeAutoCreateNcr`, opt-in) and escalate to CAPA (`checkCapaEscalation`, default 3 events in 90 days). An internal audit finding whose severity is not `observation` opens a discrepancy investigation, not an NCR. Risk level does not push into other modules. Other modules can create a risk with `sourceType` / `sourceId`.

## Quality

### NCR

`ncr.status`: `open` (default) → `contained` → `investigating` → `corrective_action` → `closed`.

Leaving `open` requires containment text, `contained` requires root cause, `investigating` requires corrective action. Close is from `corrective_action` and stamps `closedAt`. Assign is allowed from any status. Guards are `expectedFrom` checks in `ncr.service.ts`.

Resource `ncr`. Default: quality edit; engineering, production, customer service, purchasing, material management, and sales and marketing read. Transitions require edit.

Severity (`low|medium|high|critical`) is set at creation. Rejected receiving titles the auto-created NCR "high"; quarantined uses "medium". Severity does not gate a transition. `supplierId` and `receivingLineItemId` are real foreign keys.

Each transition syncs the official form one way (fields into `form_data`). Audit `entityType` is `NCR`, `action` `status_change` (or `create` on auto-create). Events: `containment`, `root_cause`, `corrective_action`, `closed`, `assigned`, `auto_created_from_receiving`.

`GET/POST /ncr`, `GET/PATCH /ncr/:id`, `POST /ncr/:id/{containment,root-cause,corrective-action,close,assign}`.

The module state machine has no simulate mode. A builder definition on `module: "ncr"` can.

### CAPA

`open` → `in_progress` → `verifying` → `closed`. All three hops go through dedicated endpoints (`/start`, `/verify`, `/close`) and one `ALLOWED_NEXT` map in `capa.controller.ts`. `updateCapaSchema` does not accept `status`, so a generic PATCH cannot skip a hop. Verify requires verification text.

Resource `capa`. Default: quality edit; other departments none.

`escalationSource` is `receiving_recurrence` when receiving opened the CAPA, otherwise null. `ncrId` and `supplierId` are foreign keys. The builder also has `escalate_capa`.

Audit `entityType` `CAPA`. Events include `verify`, `close`, and `escalated_from_receiving`.

`GET/POST /capa`, `PATCH /capa/:id`, `POST /capa/:id/{start,verify,close}`.

### 8D

The internal record is not a text status. `eight_d.currentStep` is an integer 1–8, and `data` holds `d1_team` through `d8_closure`. `completeStepHandler` increments the step. Step 8 is closure. There is no skip-ahead guard; a direct step number can complete steps out of order.

Supplier responses (`supplier_8d_responses`) are separate: `submitted` → `under_review` → `accepted` | `rejected`. Quality or Purchasing reviews them (`assertReviewer`). Once `accepted` or `rejected`, another review is refused, and setting the status to its current value is refused. That matches the portal buttons. It is not a stricter one-hop chain.

Resource `eight_d`. Default: quality edit; others none. Links: `ncrId`, `linkedNcrId`, `linkedEightDId`. No automated actions. Closure can feed a linked NCR's closure narrative. Template `eight_d_closure` listens for `closed`. Supplier-portal routes cover the response half.

### Document Control

Revisions use the shared draft → review → publish engine (`modules/versioning`, subject `document`; adapter in `modules/documents/documentVersioning.ts`). A published revision is a frozen `controlled_versions` row (database trigger) with content, revision code, effective and expiration dates, retention, files (`document_files`, SHA-256), and links to workflows, equipment, suppliers, NCRs, CAPAs, audits, and training.

Review is four-eyes (an admin exception is recorded). `document.view|edit|review|publish` sit on the `documents` resource plus a reviewer role. Customers and suppliers are refused, and the refusal is audited. `documents.status` mirrors the released revision (`approved`) or, before the first release, the open draft. PATCH of `status`, title, category, or expiration is rejected. The old one-step `POST /documents/:id/version`, `/version/upload`, and `/approve` return 410. Publish still writes the legacy `document_versions` row and emits `documents` / `approved`. Retire (`/obsolete`) is only `approved` → `obsolete`, and is refused while a revision is open.

`retentionState` is `active` or `archived`, driven by retention, not by `status`. Archive eligibility is an unarchived document whose `approvedAt` is older than `retentionPeriodDays`. The retention sweep is an endpoint, not a scheduled job.

Default access: every department can read; quality and engineering can edit. See `defaultPermissions.ts`.

Audit `entityType` `Document`. Revise is `update`, approve is `status_change` (the action enum has no `approve`), retention is `update`. The only builder event is `approved`. History and approval UI are the document panels, not `WorkflowActionButton`.

`GET /documents/expiring`, `POST /documents/retention/apply`, `GET/POST /documents`, `GET/PATCH /documents/:id`, version routes under the versioning engine, `POST /documents/:id/obsolete`, `POST /documents/:id/archive`, `GET /documents/:id/history`.

### Audit

`scheduled` → `in_progress` → `completed`. `start` requires `scheduled`. `complete` requires `in_progress`. `updateAuditSchema` does not accept `status`, so PATCH cannot skip or reverse those hops.

Resource `audit`. Default: quality edit; others none.

`type` is `internal|supplier|customer|certification`. Item severity is `observation|minor|major|critical`. A finding that is not an observation, on an internal audit, inserts a discrepancy investigation (`open`, `autoCreated`, source ids). Finding text is queued for embedding (`AI_STREAM`, job `embed`).

Audit entity types: `Audit` for start and complete; `Discrepancy investigation` for the auto-created row. Events: `start`, `complete`.

`GET/POST /audits`, `PATCH /audits/:id`, `GET/POST /audits/:id/item`, `POST /audits/:id/{start,complete}`.

### Risk / FMEA

`riskAssessments.status`: `open` → `mitigation` → `monitoring` → `closed`, linear, no skip. `updateRiskSchema` excludes `status`. `riskMitigations.status` (`planned|in_progress|completed`) is a separate field and is not on that map.

Resource `risk`. Creating is quality, engineering, production, purchasing, or material management. Field edits (severity, probability) are quality and engineering. Status transitions are quality. Delete is admin.

Severity times probability (1–5 each) is `riskScore` (1–25). Level: under 5 low, 5–9 medium, 10–15 high, 16 and up critical. FMEA RPN is severity times occurrence times detection, each 1–10. That scale is separate from the 1–5 assessment scale.

Nothing fires when the level changes. Other modules create a risk. `POST /risk/:id/ai-analysis` suggests severity, probability, and mitigations. A person applies them. Accepting a suggestion is audited as `subAction: "ai_suggestion_accepted"`. Field edits can be `subAction: "severity_probability_change"`.

Entity types `RiskAssessment` and `RiskMitigation`. Status changes store `{oldStatus, newStatus}`. Events are the new status: `mitigation`, `monitoring`, `closed`.

`GET/POST /risk`, `PUT/DELETE /risk/:id`, `POST /risk/:id/{start-mitigation,start-monitoring,close}`, `GET/POST /risk/:id/fmea`, `POST/PUT /risk/:id/mitigation[/:mid]`, `POST /risk/:id/ai-analysis`.

## Suppliers

### SCAR (portal corrective action)

`supplier_corrective_actions.status` starts at `submitted`. Review values in use include `under_review`, `accepted`, and `rejected`. Quality or Purchasing reviews. The supplier submits through the portal.

`accepted` and `rejected` are terminal. A review that does not change the status is refused. There is no stricter one-hop map than that.

Optional links: `linkedNcrId`, `linkedCapaId`. Audit entity type `SupplierCorrectiveAction`. Event module `supplier_car`, event the new status. Template `supplier_car_rejection` listens for `rejected`. Counts show on `GET /supplier-portal/kpis`. Routes are under `/supplier-portal/corrective-actions`.

The separate `scar_forms` table is the internal SCAR sheet (fixed header and fixed CAPA rows). Its `status` is `open` or `closed` so the list can filter. The source sheet had no status.

### Supplier onboarding

`POST /suppliers` creates an active supplier. There is no qualification gate on that insert. Onboarding is document collection, not the status lifecycle below.

Each `supplier_onboarding_documents` row is `submitted`, then `approved` or `rejected`. A resubmit inserts a new row. Review is Quality or Purchasing. Upload is the supplier's own portal login, scoped to their `supplierId`. Document types (W-9, NDA, quality manual, process flow, control plan, FMEA, org chart, certificates, questionnaire, agreement) do not depend on each other. Approving the set does not change `suppliers.status`, and disqualifying a supplier does not reject the documents.

`GET /supplier-portal/onboarding/status` returns the latest row per type. There is no onboarding template.

### Supplier status

`active` (default), `probation`, `suspended`, `disqualified`. Actions: `approve` → active, `conditional` → probation, `suspend` → suspended, `remove` → disqualified. `disqualified` blocks the others. `remove` is idempotent from any state.

Resource `suppliers`: quality edit; production, purchasing, and material management read. Purchasing does not approve. No email fires on the change. Audit entity type `Supplier`, `changes` `{action, from, to}`. Events: `approve`, `conditional`, `suspend`, `remove`. No template targets these events.

`GET/POST /suppliers`, `GET /suppliers/:id`, `GET /suppliers/:id/performance`, `POST /suppliers/:id/scorecard`, `GET /suppliers/:id/risk-score`, `POST /suppliers/:id/risk-score/recompute`, `POST /suppliers/:id/{approve,conditional,suspend,remove,portal-account}`.

Four supplier numbers are stored or computed separately:

- Performance review (`supplier.performance.ts`), read-only. Points 0–8: timeliness over 14 days → 2, over 7 → 1; accuracy under 75% → 2, under 90% → 1; below-min alerts 6 or more → 2, 3 or more → 1; overdue reorders 3 or more → 2, 1 or more → 1. Band: 5 or more high, 2 or more medium, else low, or `no_data`.
- Quality risk score (`supplier_quality_risk_scores`), a daily snapshot. Default weights `{ncr:20, capa:15, capaRecurrence:15, delivery:15, defectRate:15, warranty:10, responsiveness:10}`. Band: 75 or more critical, 50 high, 25 medium, else low. Recompute is `POST /suppliers/:id/risk-score/recompute` (quality or admin).
- Manual `riskLevel` on the supplier. Nothing writes it in code.
- Scorecard (`supplier_scorecards`): `qualityScore` and `deliveryScore` (0–100), `overallScore` their average. Quality or admin.

`capaRecurrenceCount` on the quality risk score and receiving's `checkCapaEscalation` both look at repeated problems and are computed on different triggers. They will not always match. One is "how risky is this supplier"; the other is "did rejections cross a threshold in the window."

### Receiving

`erp_receiving_line_items.status`: `received` → `pending_inspection` → `inspected` → `accepted` | `rejected` | `quarantined` | `disposition_required`. `disposition_required` and `quarantined` can still go to `accepted` or `rejected`. The map is `RECEIVING_TRANSITIONS` in `receivingWorkflow.ts`.

Quality owns inspection outcomes (`inspected`, `accepted`, `rejected`, `quarantined`, `disposition_required`). Material management may only move `received` → `pending_inspection`. Admin bypasses.

`defectCategory` on the linked inspection report can limit which rejections auto-create an NCR (company allow-list). On `rejected` or `quarantined`, the line transition and its audit row are written first, then `maybeAutoCreateNcr` (only if that toggle is on), then `checkCapaEscalation`. Escalation runs even when the NCR toggle is off, so the count does not skip those lines. The NCR insert is a separate write from the line transition. Concurrent rejections for the same supplier can race the threshold count.

A lot number creates or updates `inventory_lots` via `receiveIntoLot` before the NCR chain. Audit entity type `ErpReceivingLineItem`, `changes` `{from, to, notes}`. Events are the target status, module `receiving`. Template `receiving_rejection_escalation` listens for `rejected` and `quarantined`.

`POST /erp/receiving-line-items/:id/status`.

The builder's `create_ncr` / `escalate_capa` can also listen for those receiving events. Nothing stops a definition from opening a second NCR for a rejection the built-in automation already opened. The same overlap exists if a definition on audit `complete` calls `create_ncr` while the finding already opened a discrepancy investigation.

### Inspection reports

`finalStatus` is `accepted | rejected | rework_required | accepted_via_deviation`. It is a result, not a chain. PATCH may set it once from null. A later change is rejected. The report page's radio group still uses that PATCH.

Resource `quality_inspection`: quality edit; purchasing and material management read.

`inspectionType` is incoming, in process, or final. Methods include visual, dimensional, functional, documentation, and other. Checklist rows can be numeric pass/fail.

The report does not write `erp_receiving_line_items.status`, and receiving does not write the report. They meet at `receivingLineItemId`. Receiving reads `defectCategory` only for the NCR allow-list.

Audit entity type `QualityInspectionReport`. `GET/POST /quality-inspection-reports`, `PATCH/DELETE /quality-inspection-reports/:id`, item routes under that id.

### Inventory

`inventory_lots.status`: `active` → `consumed` | `scrapped` | `returned` | `expired`. `receiveIntoLot` upserts by item and lot number. `consumeFromLot` decrements and does not go negative.

`inventory_items.state` (`in_stock`, `below_min`, `reorder_pending`, `on_order`, `overstock`, `inactive`) is recomputed by `recomputeState()` on stock writes. It is not a guarded machine. `minLevel` / `maxLevel` drive below-min and overstock. `reservationRules.autoReleaseAfterDays` releases stale reservations at read time. There is no background job for that.

Movements are append-only. On-hand is derived from them. A below-min crossing opens one `inventory_alerts` row per item and type. `getLotTraceability` walks receiving line, PO line, PO, supplier, inspection report, and movements.

Lot writes publish `inventory` events: `lot-received`, `lot-consumed`, `lot-exhausted`. The below-min alert is still that fixed alert row, not a builder trigger of its own.

Resource `inventory`.

### Work orders

`planned` → `in_progress` → `completed` | `cancelled`. `cancelled` is also reachable from `planned`. Generic field PATCH (quantity, due date, notes, revision) is only allowed while `planned`. Traveler fields (quality gates, signatures, operation rows) stay editable through `in_progress` and `completed`, and lock when `cancelled`.

Resource `work_orders`: customer service edit; production, material management, purchasing, and quality read. Start, complete, cancel, and sign-off are customer service (and admin). Production does not edit the electronic traveler. The record is the back-office copy of the paper traveler.

`firstPieceInspectionPassed` and `finalQcInspectionPassed` are quality gates. `linkedNcrId` is optional. Completing posts a `produce` inventory movement in the same transaction. Signatures stamp `signedAt` on the server.

Events: `in_progress`, `completed`, `cancelled`.

`GET/POST /work-orders`, `PATCH /work-orders/:id`, `POST /work-orders/:id/{start,complete,cancel,sign-operator,sign-inspector}`, `PATCH /work-orders/:id/quality-gates`, operation routes.

## Warranty, RMA, CRAR

### Warranty

`new` → `inspection` → `supplier_review` → `approved` | `rejected` → `replaced` | `repaired` → `closed`. Branches at `supplier_review` and at `approved`. Each hop is also written to `warranty_claim_workflow` (`fromStatus`, `toStatus`, `note`, `performedByUserId`) in addition to `audit_trail`.

Resource `warranty`: customer service, quality, engineering, and purchasing edit; material management read. Per target status: `inspection` and `supplier_review` are quality and engineering; `approved` and `rejected` are quality; `replaced`, `repaired`, and `closed` are quality and customer service. The department check runs after `ALLOWED_NEXT`, so a role cannot approve a hop that is not reachable.

Claim numbers are `WC-######` (insert, then update). Cost rows recompute `warrantyActualCost`. Audit entity type `WarrantyClaim`. Events are the target statuses. Template `warranty_rejection_notification` listens for `rejected`.

`GET/POST /warranty`, `PATCH /warranty/:id`, `POST /warranty/:id/{transition,cost,document}`, `GET /warranty/analytics`.

### RMA

`draft` → `submitted_to_supplier` → `approved_by_supplier` → `in_transit` → `received_by_supplier` → `closed`. `cancelled` is reachable from any non-terminal state. `approved_by_supplier` stamps `approvedByUserId`. An internal user records what the supplier said. There is no supplier-portal hop for this flow.

Resource `rma`: purchasing, material management, and quality edit; engineering read. Most hops are purchasing and material management. `approved_by_supplier` and `closed` are purchasing. Events are the new status. `rma_closure_notification` targets RMA Log, not this module.

### RMA Log

`open` → `received` → `under_review` → `dispositioned` → `closed`. `dateReceived` and `dateClosed` are stamped when those states are entered, not taken from the client.

Resource `rma_log`: quality and customer service edit; engineering, purchasing, and material management read. Two more levels: `rma_log_status` (edit required to call the status route; quality and customer service by default) and `rma_log_linkage` (edit required to change `warrantyId`, `supplierRmaRequestId`, or `qualityId`). A denial writes `permission_denied` with `recordAuditTrailStandalone`, including outside the request transaction.

`dispositionAction` is Warranty, Scrap, Repair, Replace, or Credit. Links do not update the other record. Audit entity type `RmaLog`. Events are the four non-initial statuses. Template `rma_closure_notification` listens for `closed`. The detail page uses `WorkflowHistoryPanel` (`moduleName="rma_log"`).

`GET/POST /rma-log`, `PATCH /rma-log/:id`, `POST /rma-log/:id/status`.

### CRAR

`new` → `quality_review` → `warranty_review` → `completed`. Linear. Edits are rejected once `completed`.

Resource `crar`: quality edit; engineering and purchasing are edit at the router and then limited to `warrantyId` (`WARRANTY_LINK_ONLY_DEPARTMENTS`); customer service read. Any other field from those two departments is 403 and a `permission_denied` row. Status also needs `crar_workflow` edit (default quality, engineering, purchasing) and `STATUS_TRANSITION_DEPARTMENTS` (`quality_review` and `warranty_review` are quality; `completed` is quality, engineering, and purchasing).

`warrantyId` links a claim. If `customerId` is omitted it is copied once from that claim, on create or on a later link. Nothing writes back to the claim. Audit entity type `Crar`. Events are the three non-initial statuses. No CRAR-only starter template. The detail page uses `WorkflowHistoryPanel` (`moduleName="crar"`).

`GET/POST /crar`, `PATCH /crar/:id`, `POST /crar/:id/transition`.

## Accounts and the builder

### Users

There is no invite or pending state. `POST /users` creates an active user. Self-service registration is not offered on this installation. Deactivate is `DELETE /users/:id` (`isActive: false`). Login rejects an inactive account. Reactivation is `PATCH /users/:id`.

`POST`, `PATCH`, and `DELETE /users` require admin. `GET /users` also allows quality manager. `GET /users/:id` is any signed-in user.

`updateUser` writes an audit row (`entityType` `User`). That covers profile edits and `roleId` changes. There is no `publishEvent` on the user lifecycle, and no user-status template.

### Roles and permissions

An admin PATCH applies immediately. `users.roleId` goes through `updateUser` and is audited there. `department_permissions`, `permission_role_modules`, and `user_permission_roles` go through `permissions.controller.ts` with no second approver. Those handlers audit `DepartmentPermission`, `PermissionRole`, and `UserPermissionRole`. The permissions router requires admin except `GET /permissions/modules` and `GET /permissions/effective`, which any signed-in user can read for their own access. `getUserAccessLevel` reads the current rows. It does not cache them.

### Workflow definitions

`version` starts at 1. `versionHistory` keeps 20 objects, oldest dropped. `isActive` is the text `"true"` or `"false"` and is independent of version.

Version increments only when `body.definition !== undefined` and `JSON.stringify(body.definition) !== JSON.stringify(existing.definition)`. A rename or an `isActive` toggle does not bump the version. The audit row still records the update, with `newVersion` set to whichever is true. Each real definition change appends `{version, definition, updatedAt, updatedBy}` before the new definition is stored. Delete cascades `workflow_runs`. Entity type `WorkflowDefinition`.

Resource `workflow`: quality edit, engineering read. The editor is `apps/web/src/routes/Workflow/WorkflowBuilderPage.tsx`.

## Templates

`WORKFLOW_TEMPLATES` in `services/api/src/modules/workflow/workflow.templates.ts`:

| Key | Module | Trigger |
|---|---|---|
| `ncr_process` | ncr | NCR process graph (`ncrProcessDefinition`), not a single notify node |
| `capa_effectiveness_close` | capa | `close` |
| `eight_d_closure` | eight_d | `closed` |
| `receiving_rejection_escalation` | receiving | `rejected`, `quarantined` |
| `rma_closure_notification` | rma_log | `closed` |
| `warranty_rejection_notification` | warranty | `rejected` |
| `supplier_car_rejection` | supplier_car | `rejected` |
| `document_revision_approval` | documents | `approved` |
| `validation` | validation | `started`, then approval steps |
| `csa_fai` | fai | CSA first-article definition |
| `fpm_fai` | fai | Fuel pump first-article definition |

## Simulation

`POST /workflow/:id/run` with `simulate: true` walks the same graph and conditions as a real run. Handlers record what they would have done and skip the side effect. `send_email`, `notify_department`, and `notify_supplier` do not send. `create_ncr`, `escalate_capa`, and `assign_user` do not write. `ai_suggestion` does not call the model. `erp_sync` records that it would trigger the configured sync.

The run is stored with `workflow_runs.simulated = true` and is left out of `/workflow/health`, so a dry run is not a health signal. Module transition routes have no simulate flag. Calling one commits the change.

## Order of dependencies

Layer 0 is the company row, users, roles, and `departmentAccess.ts`. Layer 1 is the audit service, `crudFactory`, the error handler, and the event bus. Business modules sit on those two. They do not require each other except where a foreign key says so:

- Receiving needs suppliers, inventory items, and ERP purchase-order lines. Its automation also needs NCR and CAPA, because it inserts both.
- Lots need inventory items. A receiving line is optional.
- Warranty needs customers, inventory items, and suppliers. `linkedNcrId` is optional.
- CRAR needs a warranty claim. Other links are optional.
- Portal onboarding, SCAR, and 8D responses need suppliers and `users.supplierId`.
- Work orders need inventory items. `linkedNcrId` is optional.
- RMA Log needs warranty, RMA, and NCR before it is useful. The foreign keys are real.
- The builder's `create_ncr` and `escalate_capa` need those modules. `ai_suggestion` needs the AI gateway. `erp_sync` needs the ERP sync path.
- Reporting aggregates module tables, so it follows them. `/workflow/health` only reads workflow tables and does not wait on the reporting hub.
- The admin console is navigation over roles, the builder, AI settings, and system health. It does not own those state machines.

AI calls go through `runPipelineAndRecord`. `classifyOutput` (ok, stub, malformed, error) runs before usage accounting. A malformed response is stored for the error rate and is not shown as an answer. New AI endpoints should use that helper rather than `llm-gateway.ts` directly. No module transition is applied by the model. A person accepts or rejects. `safetyMode` (`standard` or `strict`) is one company setting. Strict mode also closes low-stakes summaries.

Dashboard counts and the reporting hub both read `ncr.status` (and the other status columns) through different code. They agree while both use the same "not closed" rule. There is no shared function forcing that.

Request middleware order is auth, then the request transaction (`withDb`), then the department or role check. The department check for a branching transition runs after `ALLOWED_NEXT`.
