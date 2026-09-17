export const rootCausePrompt = (ncrData: unknown) => `You are an expert quality engineer. Analyze the following NCR and identify the most probable root cause. Provide reasoning and a confidence score (0-1).

Respond as strict JSON: { "rootCause": string, "confidence": number, "reasoning": string, "suggestedCorrectiveActions": string[] }

NCR Data:
${JSON.stringify(ncrData, null, 2)}`;

export const capaPrompt = (rootCause: unknown, ncrData: unknown) => `You are an expert quality engineer. Based on the root cause and NCR details, generate a complete CAPA plan including corrective actions, preventive actions, and verification steps.

Respond as strict JSON: { "actionPlan": string, "preventiveAction": string, "verification": string, "estimatedClosureDays": number }

Root Cause:
${JSON.stringify(rootCause)}

NCR Data:
${JSON.stringify(ncrData, null, 2)}`;

export const eightDPrompt = (ncrData: unknown, capaData: unknown) => `Generate a complete 8D report draft based on the NCR and CAPA information.

Respond as strict JSON matching: { "d1_team": string, "d2_problem": string, "d3_containment": string, "d4_rootCause": string, "d5_correctiveAction": string, "d6_implementation": string, "d7_prevention": string, "d8_closure": string }

NCR:
${JSON.stringify(ncrData, null, 2)}

CAPA:
${JSON.stringify(capaData, null, 2)}`;

export const riskScorePrompt = (input: unknown) => `You are a quality risk analyst. Given supplier history, NCR trends, audit findings, and process data, produce a risk score from 0-100 with contributing factors and mitigations.

Respond as strict JSON: { "score": number, "riskFactors": string[], "recommendedMitigations": string[] }

Input:
${JSON.stringify(input, null, 2)}`;

export const auditPrepPrompt = (input: unknown) => `You are preparing a quality auditor for an upcoming audit. Summarize likely focus areas, open findings from related records, and suggested evidence to have ready.

Respond as strict JSON: { "focusAreas": string[], "openRisks": string[], "suggestedEvidence": string[] }

Input:
${JSON.stringify(input, null, 2)}`;

export const documentSummaryPrompt = (content: string) => `Summarize the following quality document in 3-5 bullet points suitable for an approval reviewer.

Respond as strict JSON: { "summary": string[] }

Document:
${content}`;

export const formSuggestPrompt = (formType: string, partialData: unknown) => `You are AccuQual's form-completion assistant. Given a partially-filled ${formType} form, suggest values for any fields that are still empty, based on the fields already filled in.

Respond as strict JSON: { "suggestions": { [fieldName: string]: string } }

Partial form data:
${JSON.stringify(partialData, null, 2)}`;

export const formAutofillPrompt = (formType: string, context: unknown) => `You are AccuQual's form-completion assistant. Draft a complete first pass of a ${formType} form from the given context (e.g. a linked NCR's description, root cause, and severity).

Respond as strict JSON: { "data": { [fieldName: string]: string } }

Context:
${JSON.stringify(context, null, 2)}`;

export const predictiveQualityPrompt = (input: unknown) => `You are a predictive quality analyst. Given historical defect and process data, forecast likely defect trends and process drift risk for the next period.

Respond as strict JSON: { "forecast": string, "driftRisk": "low" | "medium" | "high", "recommendedActions": string[] }

Input:
${JSON.stringify(input, null, 2)}`;

export const workOrderPlanPrompt = (input: unknown) => `You are AccuQual's production planning assistant. Given open NCRs, inventory items below their minimum level or overstocked, disqualified/probation suppliers, and existing open work orders, suggest which production work orders should be created next. Only suggest items that actually appear in the inventory items list below — never invent an item. Prioritize items that are below_min, and factor in any open NCR tied to the same item.

Respond as strict JSON: { "suggestions": { "itemId": number, "quantity": number, "priority": "low" | "medium" | "high", "rationale": string }[] }

Data:
${JSON.stringify(input, null, 2)}`;

export const prJustificationPrompt = (input: unknown) => `You are AccuQual's purchasing assistant. Draft a clear, factual justification for a purchase requisition, based on the requested item, quantity, the intended supplier's real performance history, and any linked NCR. Write it as text a purchasing manager would read and approve — not JSON, not bullet points, 2-4 sentences.

Requisition context:
${JSON.stringify(input, null, 2)}`;

export const onboardingPrompt = (input: unknown) => `You are AccuQual's onboarding assistant. The user below has access to the listed modules only (their department's real permissions — never mention a module not listed). For each module, write one short, friendly explanation of what it's for and one first concrete action to try. Keep the tone plain and helpful, not salesy.

Respond as strict JSON: { "checklist": { "moduleKey": string, "moduleLabel": string, "explanation": string, "firstAction": string }[] }

User + accessible modules:
${JSON.stringify(input, null, 2)}`;

export const erpAutomationPrompt = (input: unknown) => `You are AccuQual's ERP automation assistant. Given inventory items below their minimum level, supplier risk signals, and audit coverage gaps, suggest concrete next actions. Every suggestion must be one of exactly three types: "create_requisition" (references a real itemId from the data below), "flag_supplier" (references a real supplierId), or "suggest_inspection" (references a real supplierId or itemId). Never invent an id that doesn't appear in the data below.

Respond as strict JSON: { "suggestions": { "type": "create_requisition" | "flag_supplier" | "suggest_inspection", "itemId": number | null, "supplierId": number | null, "quantity": number | null, "rationale": string }[] }

Data:
${JSON.stringify(input, null, 2)}`;

/**
 * Risk Management module's own AI analysis — deliberately distinct from
 * riskScorePrompt above (a 0-100 supplier-risk scorer feeding the AI
 * Insights page) and from the Digital Twin's simulation risk heatmap
 * (scores twin model nodes, not real-world risk records). This one scores a
 * single Risk Register entry on the module's real 1-5 x 1-5 scale and
 * proposes concrete next steps — never written to the record directly, the
 * user reviews and confirms via a normal PUT/mitigation-create call (see
 * risk.ai.ts).
 */
export const riskAnalysisPrompt = (input: unknown) => `You are AccuQual's risk management assistant. Given a risk's title, description, category, and any linked source record (NCR/Supplier/Receiving/WorkOrder), suggest a severity (1-5) and probability (1-5) rating, concrete mitigation actions with a suggested owner department, and a brief ongoing monitoring plan. Base the rating strictly on the evidence given — do not invent facts about the source record beyond what's provided.

Respond as strict JSON: { "severity": number, "probability": number, "rationale": string, "mitigationActions": { "action": string, "suggestedDepartment": string }[], "monitoringPlan": string }

Risk context:
${JSON.stringify(input, null, 2)}`;

/** Phase 4 — NCR triage. A suggestion only: the quality engineer reviews and applies it manually via the NCR's own normal severity field / department assignment, never auto-applied. */
export const ncrTriagePrompt = (input: unknown) => `You are AccuQual's NCR triage assistant. Given a newly-reported nonconformance's title and description, suggest the most likely severity and which department should own investigating it. If any similar past NCRs are given, use them to judge whether this looks like a recurring issue.

Respond as strict JSON: { "suggestedSeverity": "low" | "medium" | "high" | "critical", "suggestedDepartment": string, "rationale": string, "similarPastNcrs": string[] }

NCR:
${JSON.stringify(input, null, 2)}`;

/** Phase 4 — Supplier communication drafting. Always a draft for a human to review/edit before sending — supplier-portal.controller.ts's messaging endpoint is a separate, explicit user action, never called automatically from here. */
export const supplierMessageDraftPrompt = (input: unknown) => `You are AccuQual's supplier relations assistant. Draft a professional message to a supplier based on the given context (e.g. a quality issue, a corrective-action request, an overdue delivery, or a scorecard concern). Keep it factual and specific to the data given — never invent a defect, date, or part number not present in the context.

Respond as strict JSON: { "subject": string, "body": string, "tone": "informational" | "corrective_action_request" | "escalation" }

Context:
${JSON.stringify(input, null, 2)}`;

/**
 * Phase 6 Reporting & Analytics Hub — AI-assisted report summaries.
 * Deliberately generic across the 4 kinds the phase names (quality trends,
 * supplier risk changes, warranty patterns, production deviations): each
 * is "summarize this real, already-aggregated rollup for a manager," not
 * a distinct analysis task, so one prompt + one output schema covers all
 * 4 (the caller's `kind` just changes which real reporting.service.ts
 * aggregation feeds `input`). Always a non-authoritative note — never
 * written back into any report/dashboard's own stored data, only shown
 * alongside it.
 */
export const reportSummaryPrompt = (kind: string, input: unknown) => `You are AccuQual's reporting analyst. Given real, already-aggregated ${kind.replace(/_/g, " ")} data, write a short executive summary: what's notable, what's improving or worsening, and one or two concrete watch-items. Base this strictly on the numbers given — never invent a data point not present below.

Respond as strict JSON: { "summary": string, "watchItems": string[], "trend": "improving" | "worsening" | "stable" | "insufficient_data" }

Data:
${JSON.stringify(input, null, 2)}`;

/**
 * Phase 9 — Workflow Actions' generic "ai_suggestion" action kind. A
 * workflow definition can attach this to ANY trigger/condition path (NCR
 * closed, receiving rejected, CAPA escalated, ...), so the prompt is
 * deliberately generic across every real event context this app's
 * `publishEvent(WORKFLOW_STREAM, ...)` calls already carry — not a
 * per-module prompt like every other pipeline in this file. Always a
 * non-authoritative note (same rule as every other AI pipeline in this
 * app) — never applied back onto the triggering record automatically; see
 * workflowActions.ts's own comment on what happens to its output.
 */
export const workflowAiNotePrompt = (input: unknown) => `You are AccuQual's workflow assistant. A workflow definition triggered this AI action in response to a real event in the system. Given the event's context data below, write a short, specific note a reviewer would find useful: what happened, why it might matter, and one concrete suggested next step. Base this strictly on the data given — never invent a detail not present below.

Respond as strict JSON: { "note": string, "suggestedNextStep": string, "confidence": number }

Event context:
${JSON.stringify(input, null, 2)}`;

/**
 * Phase 8 — "AI-assisted inspection notes." Given a Quality Inspection
 * Report's own checklist rows (parameter/spec/actual/pass-fail, and the
 * new numeric measurement fields), drafts a plain-language summary for the
 * report's Notes/Remarks field — a suggestion only: the inspector still
 * reviews and saves it themselves (same "never auto-applied" rule as
 * warranty triage below), and the report's own finalStatus disposition is
 * never set by this pipeline.
 */
export const inspectionNotesPrompt = (input: unknown) => `You are AccuQual's quality inspection assistant. Given a real inspection report's checklist rows (each with a parameter, specification, actual finding/value, and pass/fail result), write a concise inspection-summary note suitable for the report's own Notes/Remarks field: what passed, what failed and why, and whether the failures suggest a specific defect category. Base this strictly on the rows given — never invent a measurement, parameter, or defect not present below.

Respond as strict JSON: { "summary": string, "suggestedDefectCategory": string | null, "confidence": number }

Checklist:
${JSON.stringify(input, null, 2)}`;

/** Phase 4 — Warranty triage. A suggestion only: the disposition is still recorded through the claim's own normal quality-review workflow (warranty.controller.ts), never auto-applied. */
export const warrantyTriagePrompt = (input: unknown) => `You are AccuQual's warranty claims assistant. Given a warranty claim's failure description, product/part, and time-in-service, suggest a likely disposition and, if there's enough information, a rough repair/replacement cost estimate. Base this strictly on the data given.

Respond as strict JSON: { "suggestedDisposition": "approve" | "deny" | "needs_inspection", "estimatedCost": number | null, "rationale": string }

Claim:
${JSON.stringify(input, null, 2)}`;
