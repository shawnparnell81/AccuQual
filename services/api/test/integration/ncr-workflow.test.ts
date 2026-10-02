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
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { formData } from "../../src/drizzle/schema/forms.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";

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
    expect(disposition.body.workflow.allowedTransitions).toEqual(["Fix"]);

    const correctiveAction = await request(app).post(`/ncr/${id}/corrective-action`).set("Authorization", `Bearer ${qualityToken}`).send({ correctiveAction: "Replaced and recalibrated fixture" });
    expect(correctiveAction.status).toBe(200);
    expect(correctiveAction.body.status).toBe("fix");

    const verify = await request(app).post(`/ncr/${id}/verify`).set("Authorization", `Bearer ${qualityToken}`).send({ verification: "Re-inspection of the next lot found no misalignment" });
    expect(verify.status).toBe(200);
    expect(verify.body.status).toBe("verify");

    const closed = await request(app).post(`/ncr/${id}/close`).set("Authorization", `Bearer ${qualityToken}`);
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("closed");
    expect(closed.body.closedAt).toBeTruthy();
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
