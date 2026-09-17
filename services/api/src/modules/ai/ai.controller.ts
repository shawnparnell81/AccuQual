import type { Request, Response } from "express";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { aiRiskScores, aiSuggestions } from "../../drizzle/schema/ai.js";
import { auditTrail } from "../../drizzle/schema/auditTrail.js";
import { tenants } from "../../drizzle/schema/tenants.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail, resolveUserNames } from "../audit-trail/audit-trail.service.js";
import { runPipelineAndRecord, describeAiState, loadTenantLlmOptions, checkUsageLimit } from "./ai.usage.js";
import type { TenantDb } from "../../lib/tenantScope.js";
import * as pipelines from "./ai.pipelines.js";

/**
 * Phase 4 unification: every handler below now goes through
 * runPipelineAndRecord — the same tenant-BYOK-config + usage-limit-check +
 * audit-trail-with-aiState path ai.assistant.ts and the newer pipelines
 * (Work Order Planning, PR Justification, ERP Automation, Risk Register)
 * already used. Previously these 9 endpoints called their pipeline directly
 * and hand-inserted into ai_suggestions with no audit trail row, no BYOK
 * key, and no usage-limit check at all — a real gap the AI Enablement
 * phase's "unified AI service layer" / "AI audit trail hooks" tasks closed.
 */

export const analyzeRootCause = asyncHandler(async (req: Request, res: Response) => {
  const { ncrId, ncrData } = req.body;
  const { suggestion, output } = await runPipelineAndRecord(
    req.db! as TenantDb,
    req.tenantId!,
    req.user?.id,
    "ncr",
    "root_cause",
    { ncrId, ncrData },
    "AI-assisted triage",
    (opts) => pipelines.runRootCausePipeline(ncrData, opts)
  );
  res.json({ ...suggestion, output });
});

export const generateCapa = asyncHandler(async (req: Request, res: Response) => {
  const { ncrId, rootCause, ncrData } = req.body;
  const { suggestion, output } = await runPipelineAndRecord(
    req.db! as TenantDb,
    req.tenantId!,
    req.user?.id,
    "capa",
    "capa_generator",
    { ncrId, rootCause, ncrData },
    "AI-drafted CAPA content",
    (opts) => pipelines.runCapaGeneratorPipeline(rootCause, ncrData, opts)
  );
  res.json({ ...suggestion, output });
});

export const generateEightD = asyncHandler(async (req: Request, res: Response) => {
  const { ncrId, ncrData, capaData } = req.body;
  const { suggestion, output } = await runPipelineAndRecord(
    req.db! as TenantDb,
    req.tenantId!,
    req.user?.id,
    "8d",
    "eight_d_generator",
    { ncrId, ncrData, capaData },
    "AI-drafted",
    (opts) => pipelines.runEightDGeneratorPipeline(ncrData, capaData, opts)
  );
  res.json({ ...suggestion, output });
});

/** Distinct from riskAnalysisPrompt (risk.ai.ts, the Risk Register's own 1-5x1-5 scorer) and the "v1 formula" (supplier.performance.ts's deterministic computeSupplierPerformance) — this is the free-text 0-100 AI scorer, still logged to ai_risk_scores rather than ai_suggestions since it predates that table and other real code already reads ai_risk_scores back. */
export const riskScore = asyncHandler(async (req: Request, res: Response) => {
  const { entityType, entityId, input } = req.body;
  const db = req.db! as TenantDb;
  const tenantId = req.tenantId!;

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  const limitError = await checkUsageLimit(db, tenantId, tenant?.aiMonthlyLimit ?? null, tenant?.aiLimitEnforced ?? false);
  if (limitError) throw AppError.forbidden(limitError);
  const { llmOptions } = await loadTenantLlmOptions(db, tenantId);

  const { classified } = await pipelines.runRiskScoringPipeline(input, llmOptions);
  const output = classified.data as { score?: number };

  const [saved] = await db
    .insert(aiRiskScores)
    .values({ tenantId, entityType, entityId, score: String(output.score ?? 0), details: output, status: classified.status, errorMessage: classified.errorMessage })
    .returning();

  await recordAuditTrail(db, {
    tenantId,
    entityType: "AiRiskScore",
    entityId: saved!.id,
    action: "create",
    changes: { targetEntityType: entityType, targetEntityId: entityId, status: classified.status, errorMessage: classified.errorMessage, aiState: describeAiState(classified.status, "AI-assisted risk score") },
    performedBy: req.user?.id,
  });

  res.json(saved);
});

export const formSuggest = asyncHandler(async (req: Request, res: Response) => {
  const { formType, partialData } = req.body;
  const { suggestion, output } = await runPipelineAndRecord(
    req.db! as TenantDb,
    req.tenantId!,
    req.user?.id,
    "form",
    "form_suggest",
    { formType, partialData },
    "AI-suggested",
    (opts) => pipelines.runFormSuggestPipeline(formType, partialData, opts)
  );
  res.json({ ...suggestion, output });
});

export const formAutofill = asyncHandler(async (req: Request, res: Response) => {
  const { formType, context } = req.body;
  const { suggestion, output } = await runPipelineAndRecord(
    req.db! as TenantDb,
    req.tenantId!,
    req.user?.id,
    "form",
    "form_autofill",
    { formType, context },
    "AI-drafted",
    (opts) => pipelines.runFormAutofillPipeline(formType, context, opts)
  );
  res.json({ ...suggestion, output });
});

export const analysis = asyncHandler(async (req: Request, res: Response) => {
  const { kind, input } = req.body;

  const runners: Record<string, (opts: Parameters<typeof pipelines.runAuditPrepPipeline>[1]) => ReturnType<typeof pipelines.runAuditPrepPipeline>> = {
    audit_prep: (opts) => pipelines.runAuditPrepPipeline(input, opts),
    document_summary: (opts) => pipelines.runDocumentSummaryPipeline(String(input), opts),
    predictive_quality: (opts) => pipelines.runPredictiveQualityPipeline(input, opts),
  };
  const runner = runners[kind];
  if (!runner) throw AppError.badRequest("Unsupported analysis kind");

  // "AI-generated audit summary" is Phase 5's exact required phrase for
  // audit_prep specifically; document_summary/predictive_quality aren't
  // named by any Phase 5 task, so they keep the generic default.
  const okVerb = kind === "audit_prep" ? "AI-generated audit summary" : "AI-suggested";
  const { suggestion, output } = await runPipelineAndRecord(req.db! as TenantDb, req.tenantId!, req.user?.id, "analysis", kind, { input }, okVerb, runner);
  res.json({ ...suggestion, output });
});

// Phase 4 new module-level integration points — a suggestion only in every
// case; none of these write to the NCR/Supplier/Warranty record itself,
// exactly like the existing pipelines above (a human reviews and applies
// the suggestion through that module's own normal write path).

export const ncrTriage = asyncHandler(async (req: Request, res: Response) => {
  const { ncrId, input } = req.body;
  const { suggestion, output } = await runPipelineAndRecord(
    req.db! as TenantDb,
    req.tenantId!,
    req.user?.id,
    "ncr",
    "ncr_triage",
    { ncrId, input },
    "AI-assisted triage",
    (opts) => pipelines.runNcrTriagePipeline(input, opts)
  );
  res.json({ ...suggestion, output });
});

export const supplierMessageDraft = asyncHandler(async (req: Request, res: Response) => {
  const { supplierId, input } = req.body;
  const { suggestion, output } = await runPipelineAndRecord(
    req.db! as TenantDb,
    req.tenantId!,
    req.user?.id,
    "supplier",
    "supplier_message_draft",
    { supplierId, input },
    "AI-drafted supplier communication",
    (opts) => pipelines.runSupplierMessageDraftPipeline(input, opts)
  );
  res.json({ ...suggestion, output });
});

export const warrantyTriage = asyncHandler(async (req: Request, res: Response) => {
  const { claimId, input } = req.body;
  const { suggestion, output } = await runPipelineAndRecord(
    req.db! as TenantDb,
    req.tenantId!,
    req.user?.id,
    "warranty",
    "warranty_triage",
    { claimId, input },
    "AI-assisted warranty triage",
    (opts) => pipelines.runWarrantyTriagePipeline(input, opts)
  );
  res.json({ ...suggestion, output });
});

/** Phase 8 — "AI-assisted inspection notes." */
export const inspectionNotes = asyncHandler(async (req: Request, res: Response) => {
  const { reportId, input } = req.body;
  const { suggestion, output } = await runPipelineAndRecord(
    req.db! as TenantDb,
    req.tenantId!,
    req.user?.id,
    "quality_inspection",
    "inspection_notes",
    { reportId, input },
    "AI-assisted inspection notes",
    (opts) => pipelines.runInspectionNotesPipeline(input, opts)
  );
  res.json({ ...suggestion, output });
});

/**
 * Real browsable AI suggestion history — previously the ai_suggestions
 * table was only ever read back one row at a time (recordSuggestionDecision
 * below) or aggregated into a cross-tenant ok/stub/error COUNT for Platform
 * Admin's AI Overview (platform.service.ts's getAiOverview); nothing let a
 * tenant admin actually browse what the AI has produced. Tenant-scoped,
 * admin-gated (see ai.routes.ts), newest first, with optional `module`/
 * `status` filters and simple limit/offset paging (this table has no
 * expected-to-be-huge growth pattern that would need cursor pagination).
 *
 * Each row's accept/reject decision isn't a column on ai_suggestions itself
 * — recordSuggestionDecision below only ever writes it as a separate
 * audit_trail row (action: "decision") — so this batches one extra query
 * against audit_trail for the page's own suggestion ids rather than
 * changing that established recording shape.
 */
export const listSuggestions = asyncHandler(async (req: Request, res: Response) => {
  const db = req.db! as TenantDb;
  const tenantId = req.tenantId!;
  const { module, status } = req.query as { module?: string; status?: string };
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const conditions = [eq(aiSuggestions.tenantId, tenantId)];
  if (module) conditions.push(eq(aiSuggestions.module, module));
  if (status) conditions.push(eq(aiSuggestions.status, status));

  const [rows, totalRows] = await Promise.all([
    db.select().from(aiSuggestions).where(and(...conditions)).orderBy(desc(aiSuggestions.createdAt)).limit(limit).offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(aiSuggestions).where(and(...conditions)),
  ]);
  const total = totalRows[0]?.total ?? 0;

  const suggestionIds = rows.map((r) => r.id);
  const decisionRows = suggestionIds.length
    ? await db
        .select({ entityId: auditTrail.entityId, changes: auditTrail.changes, createdAt: auditTrail.createdAt })
        .from(auditTrail)
        .where(and(eq(auditTrail.tenantId, tenantId), eq(auditTrail.entityType, "AiSuggestion"), eq(auditTrail.action, "decision"), inArray(auditTrail.entityId, suggestionIds)))
    : [];
  // Keep the most recent decision per suggestion id — normally there's
  // exactly one, but a user re-opening and re-deciding an old suggestion
  // shouldn't show a stale first answer.
  const decisionByEntityId = new Map<number, string>();
  for (const d of [...decisionRows].sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime())) {
    decisionByEntityId.set(d.entityId, ((d.changes as { decision?: string } | null)?.decision ?? "unknown") as string);
  }

  const names = await resolveUserNames(db, rows.map((r) => r.createdBy));

  const items = rows.map((r) => ({
    ...r,
    createdByName: r.createdBy === null ? "System" : (names.get(r.createdBy) ?? `Deleted User (ID #${r.createdBy})`),
    decision: decisionByEntityId.get(r.id) ?? null,
  }));

  res.json({ items, total, limit, offset });
});

/**
 * Phase 5 — "users must explicitly accept or reject AI suggestions":
 * generation (the handlers above) already logs that a suggestion was
 * produced ("AI-suggested"/"AI-drafted"/etc.); this is the separate,
 * later event of what the user actually did with it. Every
 * AiStructuredSuggestion consumer calls this exactly once per suggestion,
 * whether the user clicked Accept, clicked Reject, or closed the dialog
 * without deciding (treated as a reject — an unactioned suggestion is not
 * a silent accept). Tenant-scoped: a suggestion id from another tenant
 * 404s, never leaks whether it exists.
 */
export const recordSuggestionDecision = asyncHandler(async (req: Request, res: Response) => {
  const suggestionId = Number(req.params.id);
  const { decision } = req.body as { decision: "accepted" | "rejected" };
  const tenantId = req.tenantId!;
  const db = req.db! as TenantDb;

  const [existing] = await db.select().from(aiSuggestions).where(and(eq(aiSuggestions.id, suggestionId), eq(aiSuggestions.tenantId, tenantId)));
  if (!existing) throw AppError.notFound("AiSuggestion");

  await recordAuditTrail(db, {
    tenantId,
    entityType: "AiSuggestion",
    entityId: suggestionId,
    action: "decision",
    changes: { decision, module: existing.module, pipeline: existing.pipeline, aiState: decision === "accepted" ? "AI-suggestion accepted" : "AI-suggestion rejected" },
    performedBy: req.user?.id,
  });

  res.status(204).send();
});
