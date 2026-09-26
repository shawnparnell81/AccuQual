import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// The shared draft -> review -> publish engine, exercised through its real HTTP
// endpoints for workflows AND the two version-controlled documents (Management
// Review, Context of the Organization): lifecycle, four-eyes review, the database
// version freeze, rollback, diffs, RBAC, company isolation, audit trail, and
// approval routing for workflow runs.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { workflowDefinitions, workflowRuns } from "../../src/drizzle/schema/workflow.js";
import { controlledVersions } from "../../src/drizzle/schema/versioning.js";
import { formData, formVersions } from "../../src/drizzle/schema/forms.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { auditRowChanges } from "../../src/drizzle/schema/auditRowChanges.js";
import { notificationLog } from "../../src/drizzle/schema/notifications.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = Date.now();

let companyId: number;

const userIds: number[] = [];
type Who = { id: number; token: string };
let author: Who; // quality department, ordinary role: can edit, cannot review
let reviewer: Who; // quality department, quality_manager
let admin: Who;
let engineer: Who; // engineering department: read-only
let production: Who; // production department: no workflow access, used as an approver
let customer: Who;


async function makeUser(co: number, label: string, roleName: string, department: string | null): Promise<Who> {
  const [u] = await db.insert(users).values({ email: `ver-${label}-${suffix}@test.local`, passwordHash: "unused", department }).returning();
  userIds.push(u!.id);
  return { id: u!.id, token: await signAccessToken({ sub: String(u!.id), roleId: null, roleName, department }) };
}
const as = (w: Who) => ({ Authorization: `Bearer ${w.token}` });

const node = (id: string, type: string, kind: string, config: Record<string, unknown> = {}) => ({ id, type, kind, config });
const edge = (from: string, to: string, branch?: string) => ({ from, to, ...(branch ? { branch } : {}) });

const validGraph = () => ({
  nodes: [node("t", "trigger", "closed"), node("c", "condition", "sev", { field: "severity", equals: "high" }), node("m", "action", "assign_user", { department: "quality" }), node("end", "end", "end")],
  edges: [edge("t", "c"), edge("c", "m", "true"), edge("m", "end")],
});

const events = async (entityType: string, entityId: number) =>
  (await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, entityType), eq(auditTrail.entityId, entityId)))).map((r) => r.changes as { event?: string; permission?: string; selfReviewed?: boolean } | null);

describe("Version control: workflows, Management Review, Context of the Organization (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const t = await ensureTestCompany();
    
    companyId = t!.id;
    
    await seedDefaultPermissions(companyId);
    author = await makeUser(companyId, "author", "operator", "quality");
    reviewer = await makeUser(companyId, "reviewer", "quality_manager", "quality");
    admin = await makeUser(companyId, "admin", "admin", null);
    engineer = await makeUser(companyId, "engineer", "operator", "engineering");
    production = await makeUser(companyId, "production", "operator", "production");
    customer = await makeUser(companyId, "customer", "customer", null);
    
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    for (const t of [companyId]) {
      await db.delete(auditRowChanges);
      await db.delete(auditTrail);
      await db.delete(notificationLog);
      await db.delete(workflowRuns);
      // Published versions are frozen by a trigger; this is a test-database teardown, so lift it for the cleanup only.
      await pool.query("ALTER TABLE controlled_versions DISABLE TRIGGER controlled_versions_freeze");
      await db.delete(controlledVersions);
      await pool.query("ALTER TABLE controlled_versions ENABLE TRIGGER controlled_versions_freeze");
      await db.delete(workflowDefinitions);
      await db.delete(formVersions);
      await db.delete(formData);
      await db.delete(departmentPermissions);
    }
    await pool.end();
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("workflow lifecycle", () => {
    let workflowId: number;
    let v1: number;
    let v2: number;

    it("creates the workflow inactive, with a first draft", async () => {
      const res = await request(app).post("/workflow").set(as(author)).send({ name: "Close-out routing", module: "ncr" });
      expect(res.status).toBe(201);
      workflowId = res.body.id;
      v1 = res.body.draftVersionId;
      expect(res.body.isActive).toBe("false");

      const current = await request(app).get(`/workflow/${workflowId}`).set(as(author));
      expect(current.body.published).toBeNull();
      expect(current.body.open).toMatchObject({ id: v1, status: "draft", versionNumber: 1 });
    });

    it("refuses to change the steps directly, and allows only one open version at a time", async () => {
      const patch = await request(app).patch(`/workflow/${workflowId}`).set(as(author)).send({ definition: validGraph() });
      expect(patch.status).toBe(409);
      const second = await request(app).post(`/workflow/${workflowId}/draft`).set(as(author)).send({});
      expect(second.status).toBe(409);
    });

    it("checks a graph live, and will not send an invalid draft for review", async () => {
      const bad = { nodes: [node("t", "trigger", "closed"), node("a", "action", "assign_user")], edges: [], metadata: { name: "Close-out routing" } };
      const check = await request(app).post(`/workflow/${workflowId}/validate`).set(as(author)).send({ payload: bad });
      expect(check.body.valid).toBe(false);
      expect(check.body.errors.map((e: { code: string }) => e.code)).toEqual(expect.arrayContaining(["dead_end", "unreachable"]));

      await request(app).put(`/workflow/${workflowId}/versions/${v1}`).set(as(author)).send({ payload: bad });
      const submit = await request(app).post(`/workflow/${workflowId}/review`).set(as(author)).send({ versionId: v1, action: "request" });
      expect(submit.status).toBe(422);
      expect(submit.body.details.errors.length).toBeGreaterThan(0);
    });

    it("locks a version once it is in review, and only a reviewer can decide", async () => {
      const good = { ...validGraph(), metadata: { name: "Close-out routing", description: "Routes closed NCRs", category: "quality" } };
      expect((await request(app).put(`/workflow/${workflowId}/versions/${v1}`).set(as(author)).send({ payload: good })).status).toBe(200);
      const submit = await request(app).post(`/workflow/${workflowId}/review`).set(as(author)).send({ versionId: v1, action: "request", notes: "Please check the routing" });
      expect(submit.status).toBe(200);
      expect(submit.body.status).toBe("in_review");

      expect((await request(app).put(`/workflow/${workflowId}/versions/${v1}`).set(as(author)).send({ payload: good })).status).toBe(409);

      // Drafting rights alone do not confer reviewing or publishing.
      expect((await request(app).post(`/workflow/${workflowId}/review`).set(as(author)).send({ versionId: v1, action: "approve" })).status).toBe(403);
      expect((await request(app).post(`/workflow/${workflowId}/publish`).set(as(author)).send({ versionId: v1 })).status).toBe(403);
      // ... and the refusal is on the record.
      expect((await events("WorkflowVersion", workflowId)).some((c) => c?.permission === "workflow.review")).toBe(true);
    });

    it("a reviewer can send it back with notes, and it returns to draft", async () => {
      const noNotes = await request(app).post(`/workflow/${workflowId}/review`).set(as(reviewer)).send({ versionId: v1, action: "reject" });
      expect(noNotes.status).toBe(400);
      const back = await request(app).post(`/workflow/${workflowId}/review`).set(as(reviewer)).send({ versionId: v1, action: "reject", notes: "Add a notification step" });
      expect(back.status).toBe(200);
      expect(back.body).toMatchObject({ status: "draft", reviewDecision: "rejected", reviewNotes: "Add a notification step" });
      expect((await request(app).post(`/workflow/${workflowId}/review`).set(as(author)).send({ versionId: v1, action: "request" })).status).toBe(200);
    });

    it("cannot publish before approval; approval then publishing puts it live, once", async () => {
      expect((await request(app).post(`/workflow/${workflowId}/publish`).set(as(reviewer)).send({ versionId: v1 })).status).toBe(409);
      expect((await request(app).post(`/workflow/${workflowId}/review`).set(as(reviewer)).send({ versionId: v1, action: "approve", notes: "Looks right" })).body.reviewDecision).toBe("approved");

      const published = await request(app).post(`/workflow/${workflowId}/publish`).set(as(reviewer)).send({ versionId: v1 });
      expect(published.status).toBe(200);
      expect(published.body).toMatchObject({ status: "published", publishedBy: reviewer.id });

      const [live] = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, workflowId));
      expect(live!.isActive).toBe("true"); // its first publish is what puts it in force
      expect(live!.version).toBe(1);
      expect((live!.definition as { nodes: unknown[] }).nodes).toHaveLength(4);

      expect((await request(app).post(`/workflow/${workflowId}/publish`).set(as(reviewer)).send({ versionId: v1 })).status).toBe(409);
      const log = await events("WorkflowVersion", workflowId);
      expect(log.map((c) => c?.event)).toEqual(expect.arrayContaining(["draft_created", "submitted_for_review", "review_rejected", "review_approved", "published"]));
    });

    it("a published version is frozen by the database itself", async () => {
      await expect(pool.query("UPDATE controlled_versions SET payload = '{}'::jsonb WHERE id = $1", [v1])).rejects.toThrow(/frozen/);
      await expect(pool.query("DELETE FROM controlled_versions WHERE id = $1", [v1])).rejects.toThrow(/cannot be deleted/);
      await expect(pool.query("UPDATE controlled_versions SET status = 'draft' WHERE id = $1", [v1])).rejects.toThrow(/only move to archived/);
      // Nothing above changed it.
      const [row] = await db.select().from(controlledVersions).where(eq(controlledVersions.id, v1));
      expect(row!.status).toBe("published");
    });

    it("a second version: nobody reviews their own work — except an admin, on the record", async () => {
      const draft = await request(app).post(`/workflow/${workflowId}/draft`).set(as(reviewer)).send({ summary: "Route to engineering too" });
      expect(draft.status).toBe(201);
      v2 = draft.body.id;
      expect(draft.body).toMatchObject({ versionNumber: 2, basedOnVersion: 1 });

      const changed = validGraph();
      changed.nodes[2] = node("m", "action", "assign_user", { department: "engineering" });
      changed.nodes.splice(3, 0, node("mail", "integration", "send_email", { to: "qa@example.com", subject: "Routed" }));
      changed.edges = [edge("t", "c"), edge("c", "m", "true"), edge("m", "mail"), edge("mail", "end")];
      await request(app).put(`/workflow/${workflowId}/versions/${v2}`).set(as(reviewer)).send({ payload: { ...changed, metadata: { name: "Close-out routing v2", category: "quality" } } });
      expect((await request(app).post(`/workflow/${workflowId}/review`).set(as(reviewer)).send({ versionId: v2, action: "request" })).status).toBe(200);

      const selfApprove = await request(app).post(`/workflow/${workflowId}/review`).set(as(reviewer)).send({ versionId: v2, action: "approve" });
      expect(selfApprove.status).toBe(403);
      expect(selfApprove.body.message).toMatch(/someone else/);

      expect((await request(app).post(`/workflow/${workflowId}/review`).set(as(admin)).send({ versionId: v2, action: "approve" })).status).toBe(200);
      expect((await events("WorkflowVersion", workflowId)).some((c) => c?.event === "review_approved" && c.selfReviewed !== true)).toBe(true);
      expect((await request(app).post(`/workflow/${workflowId}/publish`).set(as(admin)).send({ versionId: v2 })).status).toBe(200);

      const [live] = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, workflowId));
      expect(live).toMatchObject({ version: 2, name: "Close-out routing v2" });
      expect(live!.versionHistory).toHaveLength(1); // the legacy history column still records what it replaced

      const list = await request(app).get(`/workflow/${workflowId}/versions`).set(as(author));
      expect(list.body.map((v: { versionNumber: number; status: string }) => `${v.versionNumber}:${v.status}`)).toEqual(["2:published", "1:archived"]);
      expect(list.body[0].payload).toBeUndefined(); // the timeline stays light; one version carries its payload
      expect(list.body[0].publishedByName).toBeTruthy();
    });

    it("compares versions node by node, transition by transition, and records the comparison", async () => {
      const diff = await request(app).get(`/workflow/${workflowId}/version/${v2}/diff`).set(as(author));
      expect(diff.status).toBe(200);
      expect(diff.body.from.versionNumber).toBe(1);
      const key = (scope: string, k: string) => diff.body.entries.find((e: { scope: string; key: string }) => e.scope === scope && e.key === k);
      expect(key("node", "mail").change).toBe("added");
      expect(key("node", "m")).toMatchObject({ change: "changed", details: [{ field: "config.department", from: "quality", to: "engineering" }] });
      expect(key("transition", "m->end").change).toBe("removed");
      expect(key("metadata", "name").change).toBe("changed");
      expect(key("metadata", "description").change).toBe("removed");
      expect((await events("WorkflowVersion", workflowId)).some((c) => c?.event === "versions_compared")).toBe(true);
    });

    it("rolls back by making an old version the next draft, which still needs review", async () => {
      const rb = await request(app).post(`/workflow/${workflowId}/rollback`).set(as(author)).send({ versionNumber: 1 });
      expect(rb.status).toBe(201);
      expect(rb.body).toMatchObject({ versionNumber: 3, isRollback: true, basedOnVersion: 1, status: "draft" });
      expect((await request(app).post(`/workflow/${workflowId}/rollback`).set(as(author)).send({ versionNumber: 2 })).status).toBe(409); // one open version at a time

      await request(app).post(`/workflow/${workflowId}/review`).set(as(author)).send({ versionId: rb.body.id, action: "request" });
      await request(app).post(`/workflow/${workflowId}/review`).set(as(reviewer)).send({ versionId: rb.body.id, action: "approve" });
      expect((await request(app).post(`/workflow/${workflowId}/publish`).set(as(reviewer)).send({ versionId: rb.body.id })).status).toBe(200);

      const [live] = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, workflowId));
      expect(live!.version).toBe(3);
      expect((live!.definition as { nodes: { id: string }[] }).nodes.map((n) => n.id)).toEqual(["t", "c", "m", "end"]); // version 1's graph is back
      expect((await events("WorkflowVersion", workflowId)).some((c) => c?.event === "rollback_draft_created")).toBe(true);
    });

    it("a workflow with published versions cannot be deleted", async () => {
      expect((await request(app).delete(`/workflow/${workflowId}`).set(as(admin))).status).toBe(409);
    });

    it("a never-published workflow can be deleted along with its drafts", async () => {
      const created = await request(app).post("/workflow").set(as(author)).send({ name: "Scratch" });
      expect((await request(app).delete(`/workflow/${created.body.id}`).set(as(admin))).status).toBe(204);
      // Scoped to this organization and subject type: ids are only unique within a subject, and other suites' documents share the table.
      expect(await db.select().from(controlledVersions).where(and(eq(controlledVersions.subjectType, "workflow"), eq(controlledVersions.subjectId, created.body.id)))).toHaveLength(0);
    });

    it("keeps a workflow that existed before version control, starting its history at version 1 = as it stood", async () => {
      const [legacy] = await db
        .insert(workflowDefinitions)
        .values({ name: "Legacy flow", module: "capa", definition: { nodes: [node("t", "trigger", "closed"), node("a", "action", "assign_user")], edges: [edge("t", "a")] }, version: 4, versionHistory: [] })
        .returning();
      const list = await request(app).get(`/workflow/${legacy!.id}/versions`).set(as(author));
      expect(list.body).toHaveLength(1);
      expect(list.body[0]).toMatchObject({ versionNumber: 4, status: "published" });
      const draft = await request(app).post(`/workflow/${legacy!.id}/draft`).set(as(author)).send({});
      expect(draft.body.versionNumber).toBe(5);
    });

    it("isolates companies and enforces who may look, edit, and see at all", async () => {
      
      

      // engineering: read-only. Can look, cannot start a draft.
      expect((await request(app).get(`/workflow/${workflowId}/versions`).set(as(engineer))).status).toBe(200);
      expect((await request(app).post(`/workflow/${workflowId}/draft`).set(as(engineer)).send({})).status).toBe(403);
      // production: no access to the builder. customers: never.
      expect((await request(app).get(`/workflow/${workflowId}/versions`).set(as(production))).status).toBe(403);
      expect((await request(app).get(`/workflow/${workflowId}/versions`).set(as(customer))).status).toBe(403);
      expect((await request(app).post("/workflow").set(as(customer)).send({ name: "Nope" })).status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("approval routing for workflow runs", () => {
    let workflowId: number;

    it("pauses a run at an approval node and only the assigned approver can decide", async () => {
      const graph = {
        nodes: [
          node("t", "trigger", "closed"),
          node("ok", "approval", "approval", { approverDepartment: "production", message: "Release the lot?" }),
          node("yes", "action", "send_email", { to: "released@example.com", subject: "Released" }),
          node("no", "action", "send_email", { to: "held@example.com", subject: "Held" }),
        ],
        edges: [edge("t", "ok"), edge("ok", "yes", "approved"), edge("ok", "no", "rejected")],
        metadata: { name: "Lot release" },
      };
      const created = await request(app).post("/workflow").set(as(author)).send({ name: "Lot release", definition: { nodes: graph.nodes, edges: graph.edges }, metadata: {} });
      workflowId = created.body.id;
      const v = created.body.draftVersionId;
      await request(app).post(`/workflow/${workflowId}/review`).set(as(author)).send({ versionId: v, action: "request" });
      await request(app).post(`/workflow/${workflowId}/review`).set(as(reviewer)).send({ versionId: v, action: "approve" });
      expect((await request(app).post(`/workflow/${workflowId}/publish`).set(as(reviewer)).send({ versionId: v })).status).toBe(200);

      const run = await request(app).post(`/workflow/${workflowId}/run`).set(as(author)).send({ context: { lot: "L-1" } });
      expect(run.status).toBe(200);
      expect(run.body).toMatchObject({ status: "waiting_approval", currentNodeId: "ok", definitionVersion: 1 });
      expect(run.body.finishedAt).toBeNull();
      const runId = run.body.id;

      // Production has no access to the builder, but the approval is theirs.
      const pending = await request(app).get("/workflow/runs/pending-approval").set(as(production));
      expect(pending.body.map((p: { id: number }) => p.id)).toContain(runId);
      expect((await request(app).get("/workflow/runs/pending-approval").set(as(engineer))).body).toEqual([]);

      expect((await request(app).post(`/workflow/runs/${runId}/decision`).set(as(engineer)).send({ decision: "approved" })).status).toBe(403);
      

      const decided = await request(app).post(`/workflow/runs/${runId}/decision`).set(as(production)).send({ decision: "approved", notes: "Inspected" });
      expect(decided.status).toBe(200);
      expect(decided.body.status).toBe("completed");
      expect((decided.body.context.actionsRun as { kind: string; to?: string }[]).map((a) => a.to)).toEqual(["released@example.com"]);
      expect(decided.body.context.approvals).toEqual([expect.objectContaining({ node: "ok", decision: "approved", by: production.id, notes: "Inspected" })]);
      expect(decided.body.context.pendingApproval).toBeUndefined();

      expect((await request(app).post(`/workflow/runs/${runId}/decision`).set(as(production)).send({ decision: "approved" })).status).toBe(409); // already decided
      expect((await events("WorkflowRun", runId)).some((c) => c?.event === "approval_approved")).toBe(true);
    });

    it("takes the rejected path when rejected, and resumes on the version the run started with", async () => {
      const run = await request(app).post(`/workflow/${workflowId}/run`).set(as(author)).send({ context: { lot: "L-2" } });
      // A newer version goes live while this run waits...
      const draft = await request(app).post(`/workflow/${workflowId}/draft`).set(as(author)).send({});
      const [row] = await db.select().from(controlledVersions).where(eq(controlledVersions.id, draft.body.id));
      const changed = { ...(row!.payload as { nodes: { id: string; config: Record<string, unknown> }[]; edges: unknown[] }) };
      changed.nodes = changed.nodes.map((n) => (n.id === "no" ? { ...n, config: { to: "different@example.com", subject: "Held v2" } } : n));
      await request(app).put(`/workflow/${workflowId}/versions/${draft.body.id}`).set(as(author)).send({ payload: changed });
      await request(app).post(`/workflow/${workflowId}/review`).set(as(author)).send({ versionId: draft.body.id, action: "request" });
      await request(app).post(`/workflow/${workflowId}/review`).set(as(reviewer)).send({ versionId: draft.body.id, action: "approve" });
      await request(app).post(`/workflow/${workflowId}/publish`).set(as(reviewer)).send({ versionId: draft.body.id });

      // ... but the waiting run finishes on the graph it began with.
      const decided = await request(app).post(`/workflow/runs/${run.body.id}/decision`).set(as(admin)).send({ decision: "rejected" });
      expect(decided.status).toBe(200);
      expect((decided.body.context.actionsRun as { to?: string }[]).map((a) => a.to)).toEqual(["held@example.com"]);
    });

    it("a simulated run never waits", async () => {
      const sim = await request(app).post(`/workflow/${workflowId}/run`).set(as(author)).send({ context: {}, simulate: true });
      expect(sim.body.status).toBe("completed");
      expect(sim.body.simulated).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------
  describe.each([
    { path: "management-review", formType: "management_review", permission: "managementReview", sample: { chairpersonName: "Ana", reviewDate: "2026-03-01" }, changed: { chairpersonName: "Ben", reviewDate: "2026-03-01", attendanceRoster: "QA, Ops" }, label: "Chairperson Name" },
    { path: "context", formType: "context_of_organization", permission: "context", sample: { internalContext: [{ strengths: "Skilled staff" }] }, changed: { internalContext: [{ strengths: "Skilled, stable staff" }] }, label: "Strengths" },
  ])("$path (a version-controlled document)", ({ path, formType, sample, changed, label }) => {
    let v1: number;
    let v2: number;

    it("starts version 1 from the record as it stands today", async () => {
      await db.insert(formData).values({ formType, entityId: 1, data: sample, version: 3, createdBy: author.id });
      const res = await request(app).get(`/${path}/1`).set(as(author));
      expect(res.status).toBe(200);
      expect(res.body.published).toMatchObject({ versionNumber: 1, status: "published", payload: sample });
      expect(res.body.open).toBeNull();
      v1 = res.body.published.id;
      expect((await request(app).get(`/${path}/2`).set(as(author))).status).toBe(404); // a single record per organization
      expect((await request(app).post(`/${path}`).set(as(author)).send({})).status).toBe(200);
    });

    it("cannot be edited around the review through the generic form endpoints", async () => {
      const save = await request(app).post(`/forms/${formType}/1/save`).set(as(author)).send({ entityId: 1, data: { sneaky: "edit" } });
      expect(save.status).toBe(409);
      expect((await request(app).post(`/forms/${formType}/1/version`).set(as(author))).status).toBe(409);
    });

    it("draft -> review -> publish writes the live document, snapshotting the old one", async () => {
      const draft = await request(app).post(`/${path}/1/draft`).set(as(author)).send({ summary: "Quarterly update" });
      expect(draft.status).toBe(201);
      v2 = draft.body.id;
      expect(draft.body.payload).toEqual(sample); // starts as a copy of what is in force

      // The live document is untouched while the draft is being written.
      await request(app).put(`/${path}/1/versions/${v2}`).set(as(author)).send({ payload: changed });
      const [stillLive] = await db.select().from(formData).where(and(eq(formData.formType, formType)));
      expect(stillLive!.data).toEqual(sample);

      expect((await request(app).post(`/${path}/1/review`).set(as(author)).send({ versionId: v2, action: "request" })).status).toBe(200);
      expect((await request(app).post(`/${path}/1/publish`).set(as(reviewer)).send({ versionId: v2 })).status).toBe(409); // not approved yet
      expect((await request(app).post(`/${path}/1/review`).set(as(reviewer)).send({ versionId: v2, action: "approve" })).status).toBe(200);
      expect((await request(app).post(`/${path}/1/publish`).set(as(reviewer)).send({ versionId: v2 })).status).toBe(200);

      const [live] = await db.select().from(formData).where(and(eq(formData.formType, formType)));
      expect(live!.data).toEqual(changed);
      expect(live!.version).toBe(4);
      const snaps = await db.select().from(formVersions).where(eq(formVersions.formId, live!.id));
      expect(snaps.map((s) => s.data)).toContainEqual(sample); // (jsonb reorders keys, so compare structurally)

      const list = await request(app).get(`/${path}/1/versions`).set(as(engineer));
      expect(list.body.map((v: { versionNumber: number; status: string }) => `${v.versionNumber}:${v.status}`)).toEqual(["2:published", "1:archived"]);
    });

    it("shows what changed using the document's own headings", async () => {
      const diff = await request(app).get(`/${path}/1/version/${v2}/diff`).set(as(engineer));
      expect(diff.status).toBe(200);
      expect(diff.body.entries.map((e: { label: string }) => e.label).join("|")).toContain(label);
      expect(diff.body.summary.changed + diff.body.summary.added).toBeGreaterThan(0);
    });

    it("rolls back through a new draft that goes through review again", async () => {
      const rb = await request(app).post(`/${path}/1/rollback`).set(as(author)).send({ versionNumber: 1 });
      expect(rb.status).toBe(201);
      expect(rb.body.payload).toEqual(sample);
      await request(app).post(`/${path}/1/review`).set(as(author)).send({ versionId: rb.body.id, action: "request" });
      await request(app).post(`/${path}/1/review`).set(as(reviewer)).send({ versionId: rb.body.id, action: "approve" });
      await request(app).post(`/${path}/1/publish`).set(as(reviewer)).send({ versionId: rb.body.id });
      const [live] = await db.select().from(formData).where(and(eq(formData.formType, formType)));
      expect(live!.data).toEqual(sample);
      expect((await request(app).get(`/${path}/1/versions`).set(as(author))).body[0]).toMatchObject({ versionNumber: 3, isRollback: true });
    });

    it("refuses an empty document, and enforces who may view, edit and publish", async () => {
      const draft = await request(app).post(`/${path}/1/draft`).set(as(author)).send({});
      await request(app).put(`/${path}/1/versions/${draft.body.id}`).set(as(author)).send({ payload: {} });
      const submit = await request(app).post(`/${path}/1/review`).set(as(author)).send({ versionId: draft.body.id, action: "request" });
      expect(submit.status).toBe(422);
      await request(app).delete(`/${path}/1/versions/${draft.body.id}`).set(as(author));

      expect((await request(app).get(`/${path}/1`).set(as(production))).status).toBe(200); // every department reads the published document
      expect((await request(app).post(`/${path}/1/draft`).set(as(production)).send({})).status).toBe(403); // ...only quality drafts it
      expect((await request(app).get(`/${path}/1`).set(as(customer))).status).toBe(403);
       // its own, blank, singleton — never ours
    });
  });
});
