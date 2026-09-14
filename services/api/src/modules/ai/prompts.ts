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
