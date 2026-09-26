# AccuQual Implementation Sequencing

**Status:** Sequencing/planning only — no code, schema, or architecture changed to produce this document. Input: `accuqual-workflow-architecture.md` (treated as authoritative, per the brief's instruction).

---

## Part 0 — Scope reality check (read this before the rest)

The brief asks for a "build order" / "sprint plan" / "final build plan" as if all 19 named workflows were still unbuilt. **They are not.** `accuqual-workflow-architecture.md` documents that every one of these modules is already implemented, live, RBAC-gated, and audit-trailed (Phases 0–11 of this same engagement). Sequencing a from-scratch build of things that already exist would produce a fictional document with no engineering value — exactly the kind of brief-vs-reality mismatch this whole engagement has consistently corrected rather than played along with.

This document therefore does the two things that are actually real and actually useful under "implementation sequencing":

1. **The dependency graph** — genuinely valuable regardless of build status: it's the reference for (a) onboarding a new engineer, (b) safely extending or rebuilding any piece without breaking what it sits on, and (c) confirming the *historical* build order (Phases 0–11) was itself dependency-safe, which it was (see Part 2's "validated position" column).
2. **Forward sequencing of the real, remaining work** — `accuqual-workflow-architecture.md`'s Part 5 maturity matrix documented concrete, named gaps (unguarded status fields on 4 modules, a missing audit trail on user/role changes, Supplier Onboarding's disconnection from supplier status, two frontend history-panel drifts, Inventory Traceability's zero Layer-2 event coverage, CAPA's one unguarded hop, Audit's PATCH-bypass). **That is the actual unfinished implementation work in this system**, and it is what the sprint plan (Part 10) and final build plan (Part 11) sequence.

Every section below is organized to satisfy the brief's literal deliverable list, with this reframing applied consistently.

---

## Part 1 — Global Dependency Graph

```
Layer 0 — Platform foundation (must exist before anything else)
  companies + RLS  →  users + roles  →  departmentAccess.ts (RBAC primitives: ResourceKey, getUserAccessLevel)
        │
        ├──────────────────────────────────────────────────────────────────────┐
        ▼                                                                      ▼
Layer 1 — Cross-cutting services (must exist before any business module)  Event Bus
  audit-trail.service.ts (recordAuditTrail)                                (Redis Streams, WORKFLOW_STREAM/AI_STREAM)
  crudFactory.ts (generic list/get/create/update/delete)
  errorHandler.ts (logFailedTransition)
        │
        ▼
Layer 2 — Business modules (each depends on Layer 0+1, NOT on each other except where noted)
  NCR, CAPA*, 8D, Document Control, Audit, Risk/FMEA, Suppliers, Warranty, RMA, RMA Log,
  Receiving (ERP), Inspection, Inventory, Work Orders
  * CAPA optionally references NCR (ncrId) — soft dependency, nullable FK, not a build blocker
        │
        ├── Receiving depends on: Suppliers + Inventory Items + ERP (PO/line-items) [hard]
        ├── Receiving automation depends on: NCR + CAPA existing first [hard — receivingAutomation.ts inserts into both]
        ├── Inventory Lots depend on: Inventory Items + (optionally) Receiving/ERP [soft — lots can exist without a receiving line]
        ├── Warranty depends on: Customers + Inventory Items + Suppliers + NCR (linkedNcrId, soft)
        ├── CRAR depends on: Warranty (hard FK) + NCR/RMA/RMA-Log/Customers (soft FKs)
        ├── Supplier Onboarding/SCAR/8D-response depend on: Suppliers + Supplier Portal auth (users.supplierId)
        └── Work Orders depend on: Inventory Items + (optionally) NCR (linkedNcrId, soft)
        │
        ▼
Layer 3 — Cross-module automation (depends on ≥2 Layer-2 modules already existing)
  receivingAutomation.ts (maybeAutoCreateNcr, checkCapaEscalation) — needs Receiving + NCR + CAPA + Settings
  Supplier Quality Risk Score — needs NCR + CAPA + RMA + Warranty + SCAR + 8D-response + Suppliers all present
  Audit → Discrepancy Investigation auto-create — needs Audit + Discrepancy/Quality module
        │
        ▼
Layer 4 — Generic Workflow Engine (Platform Admin's Workflow Builder — Layer 2 of the two-layer
           architecture from accuqual-workflow-architecture.md Part 0)
  workflow_definitions/workflow_runs schema  →  workflow-engine.ts (pure graph executor)
        →  RBAC (`workflow` ResourceKey, depends on Layer 0)
        →  registered action handlers (workflowActions.ts) — EACH action kind has its own dependency:
             send_email/notify_department/notify_supplier → Notification service (Layer 1-adjacent)
             create_ncr/escalate_capa/assign_user → NCR/CAPA modules must already exist (Layer 2)
             ai_suggestion → AI Gateway (Layer 4b below)
        →  workflow-worker process (separate Node process, consumes the same events every Layer-2
           module already publishes — CANNOT be built before Layer 2 modules publish real events)
        →  versioning (needs the base CRUD to exist first) → simulation (needs versioning + action
           handlers to exist first, since it dry-runs the same registry)
        │
        ▼
Layer 4b — AI Gateway (independent of Layer 4, NOT a dependency of it)
  llm-gateway.ts + ai.guardrails.ts (Zod schemas) → ai.usage.ts (BYOK/usage-limit, needs Company config
  + Audit Trail) → per-module AI touchpoints (each is a Layer-2 module extension, needs that module
  to exist first) → ai_suggestion action kind in the Workflow Engine (needs BOTH Layer 4 and 4b)
        │
        ▼
Layer 5 — Reporting (depends on ALL of Layer 2/3 whose data it aggregates — must come after, never before)
  reporting.service.ts (server-aggregated, cached) — independent code path from
  Dashboard's client-side per-resource fetch — see Part 9's reporting conflict
        │
        ▼
Layer 6 — Admin Console (Phase 10 — a UNIFICATION layer over Layers 0/2/4/4b/5, cannot be built
           before ANY of: RBAC self-service (Roles & Permissions), Workflow Engine (for the
           Workflows section), AI Gateway (for AI Settings), Suppliers/Receiving/Quality settings
           (already existed as scattered Settings pages this phase consolidated), System Health
           (aggregates signals FROM every layer above it — the single most downstream piece in
           the whole system)
```

**Key structural fact this graph makes explicit:** the Workflow Engine (Layer 4) and the Admin Console (Layer 6) are both *consumers* of everything below them, never providers to Layer 2's own business logic. Sequencing either one before its Layer-2 dependencies exist and are already emitting real events would have produced an engine with nothing to react to and a console with nothing to unify — which is exactly why the real historical build order (Phases 0–8 built Layer 2 modules first, Phase 9 built the engine, Phase 10 built the console) was dependency-correct, not incidental.

---

## Part 2 — Module-by-module implementation order

"Recommended build order" = the position this module correctly occupies in the dependency graph (validated against the real historical build order, which followed it). "Sequencing notes" for a module with a documented gap point to its remediation position in Part 10, not new build work.

| # | Module | Depends on | Risk flags (from the workflow map) | Sequencing notes |
|---|---|---|---|---|
| 1 | User Onboarding | Layer 0 only | 🔴 no audit trail on `updateUser` | Must exist before literally everything (every other module needs a `performedBy` user). Remediation: add `recordAuditTrail` to `updateUser` — Sprint 1 (Part 10). |
| 2 | Role Change Workflow | User Onboarding, RBAC primitives | ⚠️ `roleId` path unaudited (permission-system path already audited) | RBAC primitives must exist before any module's `requireDepartmentAccess` calls do. Same remediation sprint as #1 (identical root cause: `updateUser`). |
| 3 | NCR | Layer 0+1 | ✅ none | Canonical example every later guarded module pattern-matched against. No remediation needed. |
| 4 | CAPA | NCR (soft, `ncrId` nullable) | ⚠️ one unguarded hop (`open→in_progress` via generic PATCH) | Could have been built in parallel with NCR (soft dependency only) — historically built alongside it. Remediation: Sprint 2. |
| 5 | Document Control | Layer 0+1 | 🔴 no RBAC, no transition guard, minimal event coverage | Independent of every other Layer-2 module — could be built/fixed in complete isolation. **Highest-risk-flag module in the platform**; remediation: Sprint 1 (see Part 10 — grouped with the other unguarded-status-field modules). |
| 6 | Audit | Layer 0+1, Discrepancy/Quality module | ⚠️ PATCH-bypass coexists with guarded start/complete | Discrepancy Investigation auto-create means Quality's discrepancy module must exist first (soft — the insert would just fail gracefully if the table didn't exist, but was built in the same phase). Remediation: Sprint 1. |
| 7 | Risk/FMEA | Layer 0+1 | ✅ none (schema-level PATCH exclusion) | Independent of every other module except its optional reverse-linkage (`sourceType`/`sourceId` to NCR/Supplier/Receiving/WorkOrder/Customer) — those referenced modules should exist first only so the "Create Risk" button has something to link from, not a hard schema dependency. No remediation needed. |
| 8 | Suppliers (status lifecycle) | Layer 0+1 | ✅ none | Must exist before Receiving, Warranty, CRAR, Supplier Onboarding, SCAR, 8D-response, Supplier Portal — the single most depended-upon Layer-2 module. |
| 9 | Supplier Onboarding | Suppliers, Supplier Portal auth | 🔴 disconnected from Suppliers' own status lifecycle | Depends on #8 + `users.supplierId` portal auth. Remediation (a real design decision, not a code bug — see Part 10) is lower priority than the unguarded-status-field cluster. |
| 10 | Supplier Corrective Action (SCAR) | Suppliers, Supplier Portal auth | 🔴 no transition guard | Same auth dependency as #9; same remediation cluster as Document Control (Sprint 1). |
| 11 | Supplier Performance Review | Suppliers, Inventory (alerts/movements), ERP (reorder requests) | N/A (stateless report) | Must come after Inventory (#15) and Receiving (#14) exist, since it reads their data — this is a genuine ordering constraint the historical build respected (Phase 7 built the risk score *after* Phase 8's inventory/receiving work landed... actually the reverse: Phase 7 shipped first with a v1 formula, Phase 8 then added the receiving/inventory factors it now also reads — confirms the formula was designed to degrade gracefully with partial data, which is why no rework was needed when Phase 8 landed later). No remediation needed. |
| 12 | Receiving | ERP (PO/line items), Suppliers, Inventory Items, NCR, CAPA | ✅ none | Cannot be built before NCR+CAPA exist (its own automation inserts into both) — a genuine hard dependency, correctly respected historically (NCR/CAPA = Phase 2-ish work, Receiving = Phase 8). |
| 13 | Inspection (Quality Inspection Reports) | Receiving (parallel FK, not a build blocker), Suppliers | 🔴 no transition guard on `finalStatus` | Same remediation cluster as Document Control/SCAR (Sprint 1). |
| 14 | Inventory Traceability | Inventory Items, Receiving (optional lot linkage) | 🔴 zero Layer-2 event coverage | Could be built independently of Receiving (a lot doesn't require a receiving line), but real-world usage assumes Receiving exists first. Remediation (adding `publishEvent` calls) is Sprint 3 — see Part 10, lowest priority since it's additive, not fixing broken behavior. |
| 15 | Production Workflow (Work Orders) | Inventory Items, NCR (soft) | ✅ none | Independent of Receiving/Inspection entirely — could have been (and was) built in parallel. |
| 16 | Warranty | Customers, Inventory Items, Suppliers, NCR (soft) | ✅ none (most instrumented module in the platform) | Requires Suppliers (#8) and a Customers module to exist first — genuine hard dependency for the FK, soft for NCR linkage. |
| 17 | RMA (plain) | Suppliers | ✅ none | Independent of Warranty/RMA-Log — parallel-buildable. |
| 18 | RMA Log | Warranty (FK), RMA (FK), NCR (FK), Supplier RMA Request (FK) | ⚠️ frontend history-panel drift (backend fully ready) | The most FK-dependent module in the platform — cannot be meaningfully built until Warranty, RMA, and NCR all already exist. Remediation (swap `EntityAuditTrailPanel` → `WorkflowHistoryPanel`) is a pure frontend change, Sprint 3, zero backend risk. |
| 19 | CRAR | Warranty (hard FK) | ⚠️ same frontend history-panel drift as #18 | Cannot exist before Warranty. Same Sprint 3 remediation as #18 — batch both together, identical fix. |
| — | Workflow Editor Change Workflow | ALL of the above (it's Layer 4, not Layer 2) | ✅ none | Deliberately listed last: the Workflow Engine's own versioning/editing cannot be meaningfully exercised until real modules exist to publish real events for it to react to. Already correctly sequenced last historically (Phase 9, after Phases 0-8's modules). |

---

## Part 3 — Workflow Engine Sequencing (Layer 4)

The real historical order (Phase 9), confirmed dependency-correct:

1. **Engine foundation** — pure graph executor (`workflow-engine.ts`: `WorkflowNode`/`WorkflowEdge`/`runWorkflow`), deliberately DB-agnostic and side-effect-free at this stage. Must exist before anything else in this layer; has no dependency on any business module.
2. **State model** — `workflow_definitions`/`workflow_runs` schema. Depends only on Layer 0 (companies).
3. **Transition model** — the graph-walk logic (trigger node matching, edge traversal). Depends on #1+#2 only.
4. **Condition model** — `evaluateCondition()` (field/operator/value against arbitrary event context). Depends on #1 — genuinely independent of any specific module's data shape (deliberately generic).
5. **Action model** — `workflowActions.ts`'s registered handlers. **This is the one sub-layer with real, unavoidable Layer-2 dependencies**: `create_ncr`/`escalate_capa` cannot be registered meaningfully before NCR/CAPA modules exist; `ai_suggestion` cannot be registered before the AI Gateway (Layer 4b) exists. This is why action-kind registration was correctly sequenced *after* both Layer 2 and Layer 4b in the real build.
6. **Audit model** — `recordAuditTrail` calls on every definition create/update/delete/run — reuses Layer 1's existing service, adds nothing new, could theoretically have shipped with #2.
7. **Versioning model** — depends on #2's CRUD existing first (there must be a definition to version). Deep-equality check on `definition` field only — correctly scoped to avoid bumping version on cosmetic renames.
8. **Simulation model** — depends on #5 (action model) existing first, since it dry-runs the exact same action registry. Cannot precede #5 in any valid sequencing.

**Sequencing constraint made explicit:** #5 (action model) is a hard fork point — everything before it is genuinely module-agnostic infrastructure; everything from #5 onward requires specific Layer-2/4b modules to already exist. A team rebuilding this from scratch must not attempt to register `create_ncr` before NCR itself exists, or `ai_suggestion` before the AI Gateway exists — both would be no-ops at best, broken imports at worst.

---

## Part 4 — RBAC Sequencing

1. **Permission enforcement order** (bottom-up, per request): `requireAuth` → `withCompanyDb` (RLS context) → `requireDepartmentAccess(resourceKey)` / `requireRole(role)` / inline `assertDepartment()` — this exact middleware order is load-bearing; reversing `withCompanyDb` and `requireDepartmentAccess` would let a department check run before company scoping exists.
2. **Approval/rejection sequencing** — every module with a branching transition (Warranty's `approved`/`rejected` fork, CRAR's linear gate) checks the target-status department requirement *after* the `ALLOWED_NEXT` structural check, never before — an admin cannot approve a transition that isn't even reachable from the current state, regardless of department.
3. **Escalation sequencing** — Receiving→CAPA escalation (`checkCapaEscalation`) is deliberately evaluated on *every* rejected/quarantined transition regardless of whether the NCR auto-create toggle is on, so escalation counting never silently under-counts just because a company disabled the NCR side — a real, correct ordering choice in the existing code (evaluate escalation unconditionally, gate only the NCR side).
4. **Cross-module RBAC alignment** — confirmed consistent pattern: every ResourceKey's default matrix follows "Quality owns quality-domain modules edit-only; adjacent departments get read; Customer Service and Purchasing get edit only on the modules they operationally own (Work Orders, ERP)." The one real inconsistency worth flagging for future sequencing: **Document Control has no ResourceKey at all** — any RBAC alignment work should add one (`documents`) before anything else touches this module, since retrofitting RBAC onto an ungated module is strictly additive and low-risk, but doing so *after* other changes land makes the diff harder to review in isolation. Sequence this first among Document Control's remediation items (Part 10, Sprint 1).

---

## Part 5 — AI Sequencing

1. **AI-assisted transitions** — none exist; no module's actual state transition is ever AI-triggered without a human confirming first (every AI touchpoint in the platform is suggest-then-human-applies). This is a design invariant, not a missing feature — flagged here so future sequencing doesn't assume otherwise.
2. **AI-assisted actions** — the Workflow Engine's `ai_suggestion` action kind (Part 3, #5) is the only AI action reachable from Layer 2 automation, and it explicitly skips the real LLM call during Simulation Mode.
3. **AI-assisted summaries** — Reporting Hub's "AI Summary" buttons, Audit's "AI Prep Summary" — all read-only, non-authoritative, never write back to the record.
4. **AI guardrail enforcement order** — `ai.guardrails.ts`'s `classifyOutput` (ok/stub/malformed/error) runs *before* `ai.usage.ts`'s usage-limit/BYOK accounting on every call — a malformed response still gets recorded (for `/admin/ai-usage`'s error-rate visibility) but never presented to the user as authoritative. Sequencing implication: any NEW module adding an AI touchpoint must route through `runPipelineAndRecord` (the single unified call every AI endpoint already goes through) rather than calling `llm-gateway.ts` directly — this ordering (guardrail check → usage record → company-safety-mode-dependent display) is the one AI sequencing rule that must never be bypassed by a new integration.

---

## Part 6 — Supplier/Receiving/Inventory Sequencing

1. **Receiving → NCR sequencing** — `transitionReceivingLineItem` completes its own state update and audit trail FIRST, then (only on `rejected`/`quarantined`) calls `maybeAutoCreateNcr`. If the NCR insert failed, the receiving-line-item transition itself is already committed — these are two separate, non-atomic writes. This is a real sequencing fact worth flagging (not a bug to fix in this phase, but relevant to any future retry/idempotency work).
2. **Receiving → CAPA escalation sequencing** — `checkCapaEscalation` runs *after* `maybeAutoCreateNcr` in the same request, and re-queries the database for the ACCUMULATED count of past rejected/quarantined lines (not just the current one) — meaning this step's correctness depends on every prior receiving transition having already committed. Sequencing constraint: this only produces correct threshold counts if receiving events are processed in real chronological order per supplier; concurrent simultaneous receiving transitions for the same supplier could theoretically race on the threshold check (a real, low-probability edge case worth flagging, not fixing here).
3. **Inventory traceability sequencing** — lot creation (`receiveIntoLot`) happens inside the same receiving flow, before the disposition-driven NCR/CAPA chain — so a lot record always exists before any NCR that might reference its `receivingLineItemId` exists. Correct as built.
4. **Supplier recurrence sequencing** — the Supplier Quality Risk Score's `capaRecurrenceCount` factor and Receiving's own `checkCapaEscalation` threshold are TWO SEPARATE recurrence-counting mechanisms reading overlapping data (both look at repeated CAPA/rejection patterns per supplier) but computed independently, on different triggers (one on every risk-score recompute, one on every receiving rejection). They will not always agree in real time — see Part 9's conflict-resolution entry on this.

---

## Part 7 — Reporting Sequencing

1. **Workflow reporting endpoints** — `reporting.service.ts`'s cached aggregation functions must be sequenced *after* every module they aggregate (Part 1's Layer 5 placement) — confirmed no reporting endpoint reads a table before that table's owning module is fully built.
2. **Workflow dashboards** — Dashboard's own client-side fetch-and-compute path is architecturally independent of Reporting Hub's server-side path (Part 9 flags why this is a real risk, not just a style choice).
3. **Workflow audit reporting** — `/workflow/health` (Layer 4's own diagnostic) is the one "reporting" surface that is NOT part of Layer 5 — it reads only `workflow_definitions`/`workflow_runs`, making it buildable immediately after Part 3's state model (#2), long before general Reporting exists. This was correctly exploited historically (Phase 9 shipped `/workflow/health` well before Phase 10's System Health dashboard existed to surface it).

---

## Part 8 — Admin Console Sequencing

1. **Workflow editor sequencing** — the Admin Console's Workflow section (Phase 10) is a pure navigation wrapper around the Phase 9 Workflow Builder page — zero new backend work, confirming Layer 6 (Admin Console) correctly added no new dependencies of its own for this section.
2. **Workflow versioning sequencing** — surfaced read-only in the console (version number displayed); the actual versioning logic (Part 3, #7) was already complete before Layer 6 existed — nothing to sequence here beyond "display it."
3. **Workflow validation sequencing** — `/workflow/health`'s structural checks (unregistered action kind, missing trigger, unknown module) were built in Layer 4 and only *surfaced* in Layer 6's System Health dashboard — the validation logic itself has no Admin-Console-specific dependency.

---

## Part 9 — Conflict Resolution

**These are real, previously undocumented risks this sequencing pass surfaced by tracing the dependency graph — not restatements of `accuqual-workflow-architecture.md`'s Part 5 gaps.**

1. **Cross-module workflow conflict — double NCR/CAPA creation risk.** Receiving's own built-in automation (`maybeAutoCreateNcr`/`checkCapaEscalation`, Layer 3) and the generic Workflow Engine's `create_ncr`/`escalate_capa` action kinds (Layer 4) are two independent code paths that can BOTH react to the same `receiving`/`rejected` or `receiving`/`quarantined` event if a company admin builds a Workflow Builder definition targeting the same trigger the built-in automation already covers. Nothing today prevents a company from ending up with two NCRs for one rejected shipment. **Resolution for future sequencing:** any admin-facing documentation or the Workflow Builder's own template picker should warn when a new definition's trigger overlaps with the receiving/`quality`/`capa` module's own already-live built-in automation, before allowing save — this is design/UX work, correctly out of scope for this phase, but flagged here as the top conflict risk found.
2. **Cross-module workflow conflict — parallel record types for the same real-world event.** An internal audit finding at `major`/`critical` severity auto-creates a Discrepancy Investigation (Layer 3). If a company separately builds a Workflow Builder definition on the `audit`/`complete` event with a `create_ncr` action, a single finding can spawn a Discrepancy Investigation AND an NCR that both describe the same nonconformance, with no cross-link between them. Same class of risk as #1, different trigger.
3. **RBAC conflict — none found that block correct operation.** Every department-matrix default was confirmed internally consistent (Part 4, item 4) with one structural gap (Document Control's missing ResourceKey) already captured in the remediation sprint, not a live conflict.
4. **AI conflict — safety mode granularity.** `safetyMode` (`standard`/`strict`) is a single company-wide setting, but the platform's AI touchpoints span very different risk profiles (Risk/FMEA severity suggestions vs. Reporting's descriptive summaries). A company that sets `strict` to protect high-stakes Risk suggestions also silently makes low-stakes Reporting summaries fail closed more often than necessary. Not a bug — a real coarseness tradeoff worth flagging for any future per-module AI settings work (explicitly out of scope for Phase 10's Admin Console, which deliberately kept this company-wide).
5. **Supplier/receiving conflict — two independent recurrence counters.** Per Part 6, item 4: the Supplier Quality Risk Score's `capaRecurrenceCount` and Receiving's `checkCapaEscalation` threshold can disagree at any given moment (different trigger times, overlapping but not identical data windows). Neither is "wrong" — they answer different questions ("how risky is this supplier right now" vs. "has this specific supplier crossed a hard rejection threshold in the last 90 days") — but a user comparing the two numbers side by side (e.g., on the Supplier detail page, which shows the risk score, next to the fact that a CAPA was just escalated) could reasonably expect them to move in lockstep. Documentation/UI copy clarifying the distinction (already partially done via the risk-score panel's own explanatory text, confirmed in Phase 10) is the existing mitigation; no code conflict to resolve.
6. **Reporting conflict — two independent computation paths for overlapping KPIs.** Dashboard's client-side `.useList()`-and-filter approach and Reporting Hub's server-side cached aggregation compute similar-sounding numbers (e.g., "Open NCRs") via genuinely separate code paths. They agree today because both ultimately read the same `ncr.status` column with the same "not closed" definition, but there is no shared computation function enforcing that agreement — a future change to one filter's definition (e.g., excluding a new terminal status) could silently desync the two displays. Flagged as a real architectural risk from tracing the dependency graph, not an existing bug.

---

## Part 10 — Sprint Plan

Sequencing the REAL remaining work (`accuqual-workflow-architecture.md` Part 5's gaps), grouped by shared root cause so each sprint fixes one pattern once rather than one module at a time.

### Sprint 1 — Audit trail & RBAC parity (highest-sensitivity gaps first)
- Add `recordAuditTrail` to `updateUser` (fixes User Onboarding + Role Change's `roleId` path in one change — same handler).
- Add a real `documents` ResourceKey + `requireDepartmentAccess` gate to Document Control (the one module with zero RBAC).
- *Dependency justification:* both are foundational-layer (Layer 0/1) fixes — sequencing them first means every subsequent sprint's remediation work is itself correctly audited/gated as it lands, rather than adding more unaudited surface area first.

### Sprint 2 — The repeated "unguarded status field" pattern (one fix, four modules)
- Add an `ALLOWED_NEXT`-style guard to: Document Control's `status`, 8D-response's `status`, SCAR's `status`, Quality Inspection Reports' `finalStatus`.
- Close CAPA's one remaining unguarded hop (`open→in_progress`) with the same pattern the other three hops already use.
- Close Audit's PATCH-bypass (remove `status` from the generic `updateAuditSchema`, matching Risk's already-correct schema-level exclusion — the proven pattern from Part 4).
- *Dependency justification:* all five fixes are the identical code pattern (`ALLOWED_NEXT` map + one guard function), already proven correct in NCR/CAPA/Risk/Warranty/RMA/RMA-Log/Receiving/Work-Orders — zero new architecture, purely applying an existing, validated pattern to the remaining modules. Grouping them into one sprint means one review pass validates the pattern once instead of five times.

### Sprint 3 — Frontend/observability polish (lowest risk, purely additive)
- Swap `EntityAuditTrailPanel` → `WorkflowHistoryPanel` on CRAR and RMA Log's detail pages (backend already supports it — zero backend risk).
- Add `publishEvent(WORKFLOW_STREAM, ...)` calls to Inventory Traceability's lot/movement writes, giving Layer 4 event coverage it currently lacks (additive only — no existing behavior changes, only enables *future* Workflow Builder definitions targeting inventory events).
- *Dependency justification:* both are purely additive with no risk of regressing existing behavior — correctly sequenced last since they unlock future capability rather than fix a present defect.

### Not sprinted (explicitly deferred, not forgotten)
- Supplier Onboarding ↔ Supplier status linkage — a real product/design decision (should approving onboarding auto-activate a supplier? should disqualifying one reject pending onboarding docs?) requiring a decision from the user, not a mechanical fix. Flagged for a future design conversation, not scheduled into these sprints.
- Part 9's conflict-resolution items (double-NCR-creation risk, parallel-record-type risk) — these are UX/product-warning features (warn an admin building a Workflow Builder definition that overlaps existing automation), not bugs, and were explicitly out of scope for a sequencing-only phase.

---

## Part 11 — Final Build Plan

The exact, non-circular, dependency-respecting order — for a hypothetical from-scratch rebuild, AND as the execution order for the three real sprints above:

```
1.  Companies + RLS + Users + Roles + RBAC primitives  (Layer 0)
2.  Audit Trail service + crudFactory + Event Bus     (Layer 1)
3.  NCR                                                (Layer 2 — canonical pattern)
4.  CAPA                                               (Layer 2 — soft dep on NCR)
5.  Risk/FMEA, Document Control, Audit, 8D             (Layer 2 — independent of each other)
6.  Suppliers (status lifecycle)                       (Layer 2 — depended on by everything below)
7.  Customers, Inventory Items, ERP (PO/line items)    (Layer 2 — depended on by Receiving/Warranty/Work Orders)
8.  Receiving                                          (Layer 2 — hard dep on NCR+CAPA+Suppliers+Inventory+ERP)
9.  Inspection, Inventory Lots/Traceability            (Layer 2/3 — soft dep on Receiving)
10. Work Orders                                        (Layer 2 — dep on Inventory Items only)
11. Supplier Onboarding, SCAR, 8D-response, Supplier Portal auth   (Layer 2 — dep on Suppliers)
12. Warranty                                           (Layer 2 — dep on Customers+Inventory+Suppliers)
13. RMA (plain)                                        (Layer 2 — dep on Suppliers)
14. RMA Log, CRAR                                      (Layer 2 — dep on Warranty+RMA+NCR — must be last in Layer 2)
15. Receiving automation (Layer 3)                     (dep on #8+#3+#4)
16. Supplier Quality Risk Score (Layer 3)              (dep on #3+#4+#12+#13+#14+#6)
17. AI Gateway foundation + guardrails (Layer 4b)      (dep on #1+#2 only — could move earlier, historically didn't need to)
18. Per-module AI touchpoints                          (dep on #17 + whichever Layer-2 module each touches)
19. Workflow Engine foundation → state → transition → condition (Layer 4, steps 1-4 from Part 3)
20. Workflow Engine action model + versioning + simulation      (Layer 4, steps 5-8 — dep on #3/#4/#17 for action kinds)
21. Reporting (Layer 5)                                (dep on ALL of #3-#16 it aggregates)
22. Admin Console (Layer 6)                            (dep on #1+#6(RBAC self-service)+#19/20+#17+ scattered
                                                         settings from #6-#16 + #21 for System Health — last)

Remediation sprints (Part 10) execute AFTER this order already exists (they do — Phases 0-11 already
built steps 1-22): Sprint 1 → Sprint 2 → Sprint 3, in that order, per Part 10's own dependency
justification (foundational-layer fixes before pattern fixes before purely-additive polish).
```

No circular dependencies exist in this graph — every arrow points strictly downward (Layer N depends only on Layer <N or same-layer siblings with soft/nullable FKs). No collisions were found between the three remediation sprints (they touch entirely disjoint files: Sprint 1 = `users.controller.ts` + a new `documents` ResourceKey; Sprint 2 = five modules' controller files, none overlapping Sprint 1's; Sprint 3 = two frontend files + inventory service files, none overlapping Sprints 1-2).
