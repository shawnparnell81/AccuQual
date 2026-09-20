import { and, eq } from "drizzle-orm";
import type { TenantDb } from "../../lib/tenantScope.js";
import { workflowDefinitions } from "../../drizzle/schema/workflow.js";
import { formData, formVersions } from "../../drizzle/schema/forms.js";
import { AppError } from "../../utils/appError.js";
import { getFormLayout } from "../forms/layouts/index.js";
import { validateWorkflow } from "../workflow/workflow-graph.js";
import type { WorkflowEdge, WorkflowNode } from "../workflow/workflow-engine.js";
import { diffFormVersions, diffWorkflowVersions, type DiffResult, type WorkflowPayload } from "./diff.js";
import * as engine from "./versioning.service.js";
import type { Actor, SubjectAdapter } from "./versioning.service.js";

const VERSION_HISTORY_CAP = 20; // same cap workflow.controller.ts has always applied to the legacy versionHistory column

// ---- Workflow -------------------------------------------------------------------------------------------------------------------------------------

export const EMPTY_WORKFLOW: WorkflowPayload = { nodes: [], edges: [], metadata: {} };

/** Normalises whatever a client (or an old definition) sends into the payload shape stored in a version. */
export function toWorkflowPayload(input: { nodes?: WorkflowNode[]; edges?: WorkflowEdge[]; metadata?: Record<string, unknown> }): WorkflowPayload {
  return {
    nodes: (input.nodes ?? []).map((n) => ({ ...n, config: n.config ?? {} })),
    edges: input.edges ?? [],
    metadata: input.metadata ?? {},
  };
}

export const workflowAdapter: SubjectAdapter = {
  subject: "workflow",
  entityType: "WorkflowVersion",
  noun: "workflow",
  notifyDepartments: ["quality"],
  blank: () => ({ ...EMPTY_WORKFLOW }) as unknown as Record<string, unknown>,

  async loadLive(db: TenantDb, tenantId: number, id: number) {
    const [row] = await db.select().from(workflowDefinitions).where(and(eq(workflowDefinitions.id, id), eq(workflowDefinitions.tenantId, tenantId)));
    if (!row) throw AppError.notFound("Workflow");
    const def = row.definition as { nodes?: WorkflowNode[]; edges?: WorkflowEdge[]; metadata?: Record<string, unknown> };
    const payload = toWorkflowPayload({ nodes: def.nodes, edges: def.edges, metadata: { ...(def.metadata ?? {}), name: row.name, ...(row.module ? { module: row.module } : {}) } });
    return { payload: payload as unknown as Record<string, unknown>, version: row.version, author: row.createdBy, exists: true };
  },

  validate(payload) {
    const p = payload as unknown as WorkflowPayload;
    const report = validateWorkflow({ nodes: p.nodes as WorkflowNode[], edges: p.edges as WorkflowEdge[], metadata: p.metadata });
    const errors = [...report.errors];
    if (!p.metadata?.name || String(p.metadata.name).trim() === "") errors.unshift({ code: "no_name", message: "Give the workflow a name." });
    return { errors, warnings: report.warnings };
  },

  async apply(db, tenantId, id, payload, info) {
    const p = payload as unknown as WorkflowPayload;
    const [existing] = await db.select().from(workflowDefinitions).where(and(eq(workflowDefinitions.id, id), eq(workflowDefinitions.tenantId, tenantId)));
    if (!existing) throw AppError.notFound("Workflow");
    // The placeholder a brand-new workflow starts with is not a version anyone ran, so it isn't added to the legacy history.
    const history = info.firstPublish ? (existing.versionHistory ?? []) : [...(existing.versionHistory ?? []), { version: existing.version, definition: existing.definition, updatedAt: new Date().toISOString(), updatedBy: info.actor }].slice(-VERSION_HISTORY_CAP);
    const { name: metaName, module: metaModule, ...restMeta } = (p.metadata ?? {}) as Record<string, unknown>;
    await db
      .update(workflowDefinitions)
      .set({
        // The graph the engine and the worker actually read. `metadata` rides along (they ignore it) so description/category survive.
        definition: { nodes: p.nodes, edges: p.edges, metadata: { name: metaName, module: metaModule, ...restMeta } } as unknown as Record<string, unknown>,
        name: typeof metaName === "string" && metaName.trim() ? metaName.trim() : existing.name,
        module: typeof metaModule === "string" && metaModule ? metaModule : existing.module,
        version: info.versionNumber,
        versionHistory: history,
        // A workflow that has never been published has never been live; its first publish is what puts it in force.
        ...(info.firstPublish ? { isActive: "true" } : {}),
        updatedAt: new Date(),
      })
      .where(eq(workflowDefinitions.id, id));
  },

  diff: (a, b) => diffWorkflowVersions(a as unknown as WorkflowPayload, b as unknown as WorkflowPayload),
};

// ---- Documents on the generic forms engine (Management Review, Context of the Organization) ---------------------------------------------

export function createFormAdapter(config: { subject: "management_review" | "context_of_organization"; formType: string; entityType: string; noun: string }): SubjectAdapter {
  const layout = getFormLayout(config.formType);
  return {
    subject: config.subject,
    entityType: config.entityType,
    noun: config.noun,
    notifyDepartments: ["quality"],
    blank: () => ({}),

    async loadLive(db: TenantDb, tenantId: number, subjectId: number) {
      const [row] = await db
        .select()
        .from(formData)
        .where(and(eq(formData.tenantId, tenantId), eq(formData.formType, config.formType), eq(formData.entityId, subjectId)));
      // version stays null: the record's own edit counter is not a version number in this scheme.
      return { payload: row?.data ?? {}, version: null, author: row?.createdBy ?? null, exists: !!row };
    },

    validate(payload) {
      const filled = Object.values(payload).some((v) => (Array.isArray(v) ? v.some((row) => row && typeof row === "object" && Object.values(row as object).some((c) => c !== "" && c !== null && c !== undefined)) : v !== "" && v !== null && v !== undefined));
      return filled ? { errors: [], warnings: [] } : { errors: [{ code: "empty", message: `The ${config.noun} is empty — fill in at least one section.` }], warnings: [] };
    },

    async apply(db, tenantId, subjectId, payload, info) {
      const [existing] = await db
        .select()
        .from(formData)
        .where(and(eq(formData.tenantId, tenantId), eq(formData.formType, config.formType), eq(formData.entityId, subjectId)));
      if (existing) {
        // The live form_data keeps its own snapshot trail too, so the forms module's history still tells the truth.
        await db.insert(formVersions).values({ tenantId, formId: existing.id, version: existing.version, data: existing.data, createdBy: info.actor });
        await db.update(formData).set({ data: payload, version: existing.version + 1, updatedAt: new Date() }).where(eq(formData.id, existing.id));
      } else {
        await db.insert(formData).values({ tenantId, formType: config.formType, entityId: subjectId, data: payload, version: 1, createdBy: info.actor });
      }
    },

    diff: (a, b): DiffResult => diffFormVersions(layout, a, b),
  };
}

export const managementReviewAdapter = createFormAdapter({ subject: "management_review", formType: "management_review", entityType: "ManagementReviewVersion", noun: "management review" });
export const contextAdapter = createFormAdapter({ subject: "context_of_organization", formType: "context_of_organization", entityType: "ContextVersion", noun: "context analysis" });

/** Node-, transition- and metadata-level diff of two workflow versions. */
export { diffWorkflowVersions } from "./diff.js";
export const diffManagementReviewVersions = (before: Record<string, unknown>, after: Record<string, unknown>) => managementReviewAdapter.diff(before, after);
export const diffContextVersions = (before: Record<string, unknown>, after: Record<string, unknown>) => contextAdapter.diff(before, after);

// ---- The named operations the lifecycle exposes for workflows -------------------------------------------------------------------------------------------

/** Publishes an approved, in-review workflow version: validates, writes it live, archives what it replaces, notifies. */
export const publishWorkflow = (db: TenantDb, tenantId: number, workflowId: number, versionId: number, actor: Actor) => engine.publishVersion(db, workflowAdapter, tenantId, workflowId, versionId, actor);

/** Rollback: a new draft with an earlier version's content (which then goes through review and publishing). */
export const rollbackWorkflow = (db: TenantDb, tenantId: number, workflowId: number, versionNumber: number, actor: Actor) => engine.rollbackTo(db, workflowAdapter, tenantId, workflowId, versionNumber, actor);
