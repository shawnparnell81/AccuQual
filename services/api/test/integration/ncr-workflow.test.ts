import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Full-System Audit finding H4: NCR — this app's highest-traffic module,
// and the one every other quality workflow (CAPA/8D/receiving automation)
// hangs off — had zero dedicated test coverage. Every existing reference to
// POST /ncr in the suite was incidental (a fixture for an unrelated RBAC or
// audit-trail test), never a test of the NCR workflow itself
// (NCR Created -> Contain -> Disposition -> Fix -> Verify -> Closed, each
// step gated by ncr.service.ts's own expectedFrom check).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { validationReports } from "../../src/drizzle/schema/validationReport.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = Date.now();

let companyId: number;
const userIds: number[] = [];
let qualityToken: string;
let engineeringToken: string;

async function makeUser(department: string | null) {
  const [user] = await db.insert(users).values({ email: `ncr-workflow-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName: "operator", department });
}

async function createNcr(token: string, title: string) {
  const res = await request(app).post("/ncr").set("Authorization", `Bearer ${token}`).send({ title, severity: "high" });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

const CLOSURE_PATHS = [
  "closureApprovals.0.signature",
  "closureApprovals.1.signature",
  "closureApprovals.2.signature",
  "closureApprovals.3.signature",
] as const;

/** Required Yes/No is the permission configuration. A save keeps the rest of the document. */
async function setClosureRequired(token: string, id: number, choices: Record<string, "yes" | "no">) {
  const form = await request(app).get(`/forms/ncr/${id}`).set("Authorization", `Bearer ${token}`);
  expect(form.status).toBe(200);
  const data = (form.body?.data ?? {}) as Record<string, unknown>;
  const current = (typeof data._signatureRequired === "object" && data._signatureRequired ? data._signatureRequired : {}) as Record<string, string>;
  const saved = await request(app)
    .post(`/forms/ncr/${id}/save`)
    .set("Authorization", `Bearer ${token}`)
    .send({ data: { ...data, _signatureRequired: { ...current, ...choices } } });
  expect(saved.status).toBe(200);
}

describe("NCR workflow (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;
    await seedDefaultPermissions(companyId);

    qualityToken = await makeUser("quality");
    engineeringToken = await makeUser("engineering"); // ncr's default permissions are quality-only — engineering has zero access
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("engineering (zero access to ncr) cannot create an NCR at all", async () => {
    const res = await request(app).post("/ncr").set("Authorization", `Bearer ${engineeringToken}`).send({ title: "Should be blocked" });
    expect(res.status).toBe(403);
  });

  it("a fresh NCR starts at NCR Created", async () => {
    const id = await createNcr(qualityToken, "Fresh NCR");
    const res = await request(app).get(`/ncr/${id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.body.status).toBe("ncr_created");
    expect(res.body.workflow.currentStep).toBe("NCR Created");
    expect(res.body.workflow.allowedTransitions).toEqual(["Contain"]);
    expect(res.body.workflow.history.map((entry: { step: string }) => entry.step)).toEqual(["NCR Created"]);
  });

  it("root-cause cannot be recorded before containment — the workflow rejects out-of-order steps", async () => {
    const id = await createNcr(qualityToken, "Out of order NCR");
    const res = await request(app).post(`/ncr/${id}/root-cause`).set("Authorization", `Bearer ${qualityToken}`).send({ rootCause: "Skipped containment" });
    expect(res.status).toBe(400);
  });

  it("closing an NCR straight from open is rejected — must go through the full sequence", async () => {
    const id = await createNcr(qualityToken, "Premature close NCR");
    const res = await request(app).post(`/ncr/${id}/close`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(400);
  });

  it("walks NCR Created -> Contain -> Disposition -> Fix -> Verify -> Closed", async () => {
    const id = await createNcr(qualityToken, "Full lifecycle NCR");

    const containment = await request(app).post(`/ncr/${id}/containment`).set("Authorization", `Bearer ${qualityToken}`).send({ containment: "Quarantined the affected lot" });
    expect(containment.status).toBe(200);
    expect(containment.body.status).toBe("contain");
    expect(containment.body.containment).toBe("Quarantined the affected lot");
    expect(containment.body.workflow.currentStep).toBe("Contain");

    const rootCause = await request(app).post(`/ncr/${id}/root-cause`).set("Authorization", `Bearer ${qualityToken}`).send({ rootCause: "Fixture misalignment on line 2" });
    expect(rootCause.status).toBe(200);
    expect(rootCause.body.status).toBe("contain");
    expect(rootCause.body.rootCause).toBe("Fixture misalignment on line 2");

    const disposition = await request(app).post(`/ncr/${id}/disposition-step`).set("Authorization", `Bearer ${qualityToken}`).send({ note: "Scrap the lot" });
    expect(disposition.status).toBe(200);
    expect(disposition.body.status).toBe("disposition");
    expect(disposition.body.processData.dispositionNote).toBe("Scrap the lot");
    expect(disposition.body.workflow.allowedTransitions).toEqual(["Fix"]);

    const correctiveAction = await request(app).post(`/ncr/${id}/corrective-action`).set("Authorization", `Bearer ${qualityToken}`).send({ correctiveAction: "Replaced and recalibrated fixture" });
    expect(correctiveAction.status).toBe(200);
    expect(correctiveAction.body.status).toBe("fix");

    const verify = await request(app).post(`/ncr/${id}/verify`).set("Authorization", `Bearer ${qualityToken}`).send({ verification: "Re-inspection of the next lot found no misalignment" });
    expect(verify.status).toBe(200);
    expect(verify.body.status).toBe("verify");
    expect(verify.body.processData.verification).toBe("Re-inspection of the next lot found no misalignment");

    const printed = await request(app).get(`/forms/ncr/${id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(printed.status).toBe(200);
    const sheet = printed.body.data as {
      containmentActions: { action?: string }[];
      identifiedRootCauseSummary?: string;
      fiveWhyAnalysis: { answer?: string }[];
      correctiveActions: { description?: string }[];
      effectivenessVerification: { resultObservations?: string }[];
      suspectMaterialDisposition: { disposition?: Record<string, boolean> }[];
    };
    expect(sheet.containmentActions[0]?.action).toBe("Quarantined the affected lot");
    expect(sheet.identifiedRootCauseSummary).toBe("Fixture misalignment on line 2");
    expect(sheet.fiveWhyAnalysis[4]?.answer).toBe("Fixture misalignment on line 2");
    expect(sheet.correctiveActions[0]?.description).toBe("Replaced and recalibrated fixture");
    expect(sheet.effectivenessVerification[0]?.resultObservations).toBe("Re-inspection of the next lot found no misalignment");
    expect(sheet.suspectMaterialDisposition[0]?.disposition?.Scrap).toBe(true);

    const unsigned = await request(app).post(`/ncr/${id}/close`).set("Authorization", `Bearer ${qualityToken}`);
    expect(unsigned.status).toBe(400);
    expect(unsigned.body.message).toMatch(/Sign these before closing/);
    expect(unsigned.body.message).toMatch(/Quality Manager/);
    expect(unsigned.body.message).toMatch(/Customer Representative/);

    await setClosureRequired(qualityToken, id, { "closureApprovals.3.signature": "no" });
    const customerWaived = await request(app).post(`/ncr/${id}/close`).set("Authorization", `Bearer ${qualityToken}`);
    expect(customerWaived.status).toBe(400);
    expect(customerWaived.body.message).toMatch(/Quality Manager/);
    expect(customerWaived.body.message).not.toMatch(/Customer Representative/);

    await setClosureRequired(qualityToken, id, Object.fromEntries(CLOSURE_PATHS.map((path) => [path, "no"])));
    const closed = await request(app).post(`/ncr/${id}/close`).set("Authorization", `Bearer ${qualityToken}`);
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("closed");
    expect(closed.body.closedAt).toBeTruthy();
    expect(closed.body.processData.verification).toBe("Re-inspection of the next lot found no misalignment");
    expect(closed.body.processData.dispositionNote).toBe("Scrap the lot");
    expect(closed.body.workflow.currentStep).toBe("Closed");
    expect(closed.body.workflow.allowedTransitions).toEqual([]);
    expect(closed.body.workflow.history.map((entry: { step: string }) => entry.step)).toEqual([
      "NCR Created",
      "Contain",
      "Disposition",
      "Fix",
      "Verify",
      "Closed",
    ]);

    const trail = await db.select().from(auditTrail).where(eq(auditTrail.entityId, id));
    const actions = trail.filter((t) => t.entityType === "NCR").map((t) => (t.changes as { action?: string; step?: string })?.action);
    expect(actions).toEqual(expect.arrayContaining(["containment", "root_cause", "disposition", "fix", "verify", "closed"]));
    const closedAudit = trail.find((t) => t.entityType === "NCR" && (t.changes as { action?: string } | null)?.action === "closed");
    expect((closedAudit?.changes as { closureSignatures?: string[] } | null)?.closureSignatures).toEqual([]);
    const verifyAudit = trail.find((t) => t.entityType === "NCR" && (t.changes as { action?: string } | null)?.action === "verify");
    expect((verifyAudit?.changes as { verification?: string; note?: string } | null)?.verification).toBe("Re-inspection of the next lot found no misalignment");
    expect((verifyAudit?.changes as { note?: string } | null)?.note).toBe("Re-inspection of the next lot found no misalignment");
    const steps = trail.filter((t) => t.entityType === "NCR").map((t) => (t.changes as { step?: string })?.step);
    expect(steps).toEqual(expect.arrayContaining(["Contain", "Disposition", "Fix", "Verify", "Closed"]));
  });

  it("reads an old stored step as the new one", async () => {
    const id = await createNcr(qualityToken, "Legacy step NCR");
    await db.update(ncr).set({ status: "investigating" }).where(eq(ncr.id, id));
    const res = await request(app).get(`/ncr/${id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.body.status).toBe("disposition");
    expect(res.body.workflow.currentStep).toBe("Disposition");
  });

  it("writes an audit line for each saved form field, including the first save", async () => {
    const id = await createNcr(qualityToken, "Nonconformance Report");
    const payload = {
      ncrNumber: "TEST-1008-01",
      nonconformanceDescription: "Hole oversize on the first piece\nSecond line stays off the list",
      ncrClassification: [{ classification: { Minor: false, Major: true, Critical: false } }],
    };
    const first = await request(app).post(`/forms/ncr/${id}/save`).set("Authorization", `Bearer ${qualityToken}`).send({ data: payload });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/forms/ncr/${id}/save`)
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ data: { ...payload, nonconformanceDescription: "Hole oversize after the edit" } });
    expect(second.status).toBe(200);

    const history = await request(app).get(`/workflow/history/ncr/${id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(history.status).toBe(200);
    const saves = (history.body as { changes?: { event?: string; edits?: { label: string; from: string; to: string }[] } }[]).filter((row) => row.changes?.event === "form_saved");
    const edits = saves.flatMap((row) => row.changes?.edits ?? []);
    expect(edits).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "NCR Number", from: "(blank)", to: "TEST-1008-01" }),
      expect.objectContaining({ label: "Nonconformance Description", from: "(blank)", to: "Hole oversize on the first piece\nSecond line stays off the list" }),
      expect.objectContaining({ label: "Nonconformance Description", from: "Hole oversize on the first piece\nSecond line stays off the list", to: "Hole oversize after the edit" }),
    ]));

    const list = await request(app).get("/ncr").set("Authorization", `Bearer ${qualityToken}`);
    expect(list.status).toBe(200);
    const row = (list.body as { id: number; classification?: string; whatHappened?: string }[]).find((item) => item.id === id);
    expect(row?.classification).toBe("Major");
    expect(row?.whatHappened).toBe("Hole oversize after the edit");
  });

  it("writes the NCR document back onto the workflow fields", async () => {
    const id = await createNcr(qualityToken, "Document writeback NCR");
    const form = await request(app).get(`/forms/ncr/${id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(form.status).toBe(200);
    const data = (form.body?.data ?? {}) as Record<string, unknown>;
    const saved = await request(app)
      .post(`/forms/ncr/${id}/save`)
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({
        data: {
          ...data,
          containmentActions: [{ action: "Isolated the bench" }, {}, {}],
          identifiedRootCauseSummary: "Worn locator on station 3",
          fiveWhyAnalysis: [{}, {}, {}, {}, { answer: "Worn locator on station 3" }],
          correctiveActions: [{ description: "Replaced the locator" }, {}, {}, {}, {}],
          effectivenessVerification: [{ resultObservations: "Next ten pieces passed" }, {}, {}],
          suspectMaterialDisposition: [{ disposition: { Scrap: true } }],
        },
      });
    expect(saved.status).toBe(200);

    const row = await request(app).get(`/ncr/${id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(row.status).toBe(200);
    expect(row.body.status).toBe("ncr_created");
    expect(row.body.containment).toBe("Isolated the bench");
    expect(row.body.rootCause).toBe("Worn locator on station 3");
    expect(row.body.correctiveAction).toBe("Replaced the locator");
    expect(row.body.processData.verification).toBe("Next ten pieces passed");
    expect(row.body.processData.dispositionNote).toBe("Scrap");
  });

  it("links an existing validation report by its number", async () => {
    const number = `DEMO-CSA-${suffix}`;
    const [report] = await db.insert(validationReports).values({ recordNumber: number, data: { formType: "csa", cells: {} } }).returning();
    const id = await createNcr(qualityToken, "Linked from a validation");

    const found = await request(app).get("/ncr/source-records").query({ q: number }).set("Authorization", `Bearer ${qualityToken}`);
    expect(found.status).toBe(200);
    expect(found.body).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "validation", id: report!.id, recordNumber: number, path: `/validation-reports/${report!.id}` })]));

    const linked = await request(app).post(`/ncr/${id}/source-link`).set("Authorization", `Bearer ${qualityToken}`).send({ kind: "validation", id: report!.id });
    expect(linked.status).toBe(200);
    expect(linked.body.processData.validationSource).toMatchObject({ kind: "validation", reportId: report!.id, recordNumber: number, path: `/validation-reports/${report!.id}` });

    const [stored] = await db.select().from(validationReports).where(eq(validationReports.id, report!.id));
    expect(stored?.data?.linkedNcrs).toEqual(expect.arrayContaining([{ id }]));
    const trail = await db.select().from(auditTrail).where(eq(auditTrail.entityId, id));
    expect(trail.some((row) => row.entityType === "NCR" && (row.changes as { event?: string } | null)?.event === "source_linked")).toBe(true);
  });

  it("assign works from any status — it isn't a lifecycle step", async () => {
    const id = await createNcr(qualityToken, "Assignable NCR");
    const [target] = await db.insert(users).values({ email: `ncr-assignee-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userIds.push(target!.id);

    const res = await request(app).post(`/ncr/${id}/assign`).set("Authorization", `Bearer ${qualityToken}`).send({ assignedTo: target!.id });
    expect(res.status).toBe(200);
    expect(res.body.assignedTo).toBe(target!.id);
    expect(res.body.status).toBe("ncr_created"); // unchanged — assignment isn't a status transition
  });
});
