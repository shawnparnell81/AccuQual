// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Covers the unified Feasibility Review module: full CRUD, the draft ->
// submitted -> under_review -> approved|rejected workflow with department
// gating, the generic scores sub-resource driving overallScore/decision
// automatically, quality-or-admin delete, and a real "feasibility" context
// case in ai.assistant.ts (routed through POST /ai/assistant, not a
// dedicated pipeline, per the module's own locked decision).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray, and } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { feasibilityReviews, feasibilityScores } from "../../src/drizzle/schema/feasibility.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
let ncrId: number;
let feasibilityId: number;
const userIds: number[] = [];

let qualityToken: string;
let engineeringToken: string;
let productionToken: string;
let customerServiceToken: string;
let adminToken: string;

async function makeUser(department: string | null, roleName = "operator") {
  const [user] = await db.insert(users).values({ tenantId, email: `feas-test-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName, department });
}

describe("Feasibility Review module (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `Feasibility Test Tenant ${suffix}`, code: `feas-test-${suffix}` }).returning();
    tenantId = tenant!.id;

    const [ncrRow] = await db.insert(ncr).values({ tenantId, title: "Feasibility test NCR", description: "x" }).returning();
    ncrId = ncrRow!.id;

    qualityToken = await makeUser("quality");
    engineeringToken = await makeUser("engineering");
    productionToken = await makeUser("production");
    customerServiceToken = await makeUser("customer_service"); // not in feasibility's PERMISSION_MATRIX at all
    adminToken = await makeUser(null, "admin");
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(inArray(auditTrail.performedBy, userIds));
    if (feasibilityId) {
      await db.delete(feasibilityScores).where(eq(feasibilityScores.feasibilityId, feasibilityId));
      await db.delete(feasibilityReviews).where(eq(feasibilityReviews.id, feasibilityId));
    }
    await db.delete(ncr).where(eq(ncr.id, ncrId));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it("customer_service (no matrix entry for feasibility at all) cannot create a review", async () => {
    const res = await request(app).post("/feasibility").set("Authorization", `Bearer ${customerServiceToken}`).send({ title: "x" });
    expect(res.status).toBe(403);
  });

  it("quality can create a review linked to a real NCR", async () => {
    const res = await request(app)
      .post("/feasibility")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ title: "Feasibility of reworking the affected lot", sourceType: "ncr", sourceId: ncrId, department: "quality" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("draft");
    expect(res.body.overallScore).toBeNull();
    feasibilityId = res.body.id;

    const [row] = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "FeasibilityReview"), eq(auditTrail.entityId, feasibilityId), eq(auditTrail.action, "create")));
    expect(row).toBeTruthy();
  });

  it("production cannot update the core record — only quality/engineering can", async () => {
    const res = await request(app).put(`/feasibility/${feasibilityId}`).set("Authorization", `Bearer ${productionToken}`).send({ title: "hijacked" });
    expect(res.status).toBe(403);
  });

  it("production CAN add a score even though it can't edit the record itself", async () => {
    const res = await request(app)
      .post(`/feasibility/${feasibilityId}/scores`)
      .set("Authorization", `Bearer ${productionToken}`)
      .send({ dimensionKey: "reworkFeasibility", dimensionLabel: "Rework Feasibility", value: 4 });
    expect(res.status).toBe(201);

    const [review] = await db.select().from(feasibilityReviews).where(eq(feasibilityReviews.id, feasibilityId));
    expect(Number(review!.overallScore)).toBe(4); // one unweighted score -> plain average
    expect(review!.decision).toBe("feasible"); // 4 >= FEASIBLE_MIN (3.5)
  });

  it("a second unweighted score recomputes the average and decision correctly", async () => {
    const res = await request(app)
      .post(`/feasibility/${feasibilityId}/scores`)
      .set("Authorization", `Bearer ${engineeringToken}`)
      .send({ dimensionKey: "costImpact", dimensionLabel: "Cost Impact", value: 2 });
    expect(res.status).toBe(201);

    const [review] = await db.select().from(feasibilityReviews).where(eq(feasibilityReviews.id, feasibilityId));
    expect(Number(review!.overallScore)).toBe(3); // (4 + 2) / 2
    expect(review!.decision).toBe("conditional"); // 3 is between 2.5 and 3.5
  });

  it("cannot skip the workflow — draft straight to approved is rejected", async () => {
    const res = await request(app).post(`/feasibility/${feasibilityId}/approve`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(400);
  });

  it("production cannot drive the workflow forward — quality only", async () => {
    const res = await request(app).post(`/feasibility/${feasibilityId}/submit`).set("Authorization", `Bearer ${productionToken}`);
    expect(res.status).toBe(403);
  });

  it("quality drives the real workflow: draft -> submitted -> under_review -> approved", async () => {
    const submitted = await request(app).post(`/feasibility/${feasibilityId}/submit`).set("Authorization", `Bearer ${qualityToken}`);
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe("submitted");

    const underReview = await request(app).post(`/feasibility/${feasibilityId}/review`).set("Authorization", `Bearer ${qualityToken}`);
    expect(underReview.status).toBe(200);
    expect(underReview.body.status).toBe("under_review");

    const approved = await request(app).post(`/feasibility/${feasibilityId}/approve`).set("Authorization", `Bearer ${qualityToken}`);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("approved");
    expect(approved.body.decidedAt).toBeTruthy();

    const statusChanges = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "FeasibilityReview"), eq(auditTrail.entityId, feasibilityId), eq(auditTrail.action, "status_change")));
    expect(statusChanges.length).toBe(3);
  });

  it("the generic /ai/assistant endpoint answers with feasibility context (honest no-key stub in this test env), not a dedicated pipeline", async () => {
    const res = await request(app)
      .post("/ai/assistant")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ messages: [{ role: "user", content: "Summarize this feasibility review." }], context: { module: "feasibility", recordId: feasibilityId } });
    expect(res.status).toBe(200);
    expect(res.body.content).toBeTruthy();

    const [row] = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "AiAssistantMessage"), eq(auditTrail.tenantId, tenantId)));
    expect((row?.changes as { module?: string })?.module).toBe("feasibility");
  });

  it("production cannot delete — only quality or admin", async () => {
    const res = await request(app).delete(`/feasibility/${feasibilityId}`).set("Authorization", `Bearer ${productionToken}`);
    expect(res.status).toBe(403);
  });

  it("quality CAN delete (this module's delete rule is wider than risk's admin-only), logged before the row disappears", async () => {
    const res = await request(app).delete(`/feasibility/${feasibilityId}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(204);

    const [gone] = await db.select().from(feasibilityReviews).where(eq(feasibilityReviews.id, feasibilityId));
    expect(gone).toBeUndefined();

    const [row] = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "FeasibilityReview"), eq(auditTrail.entityId, feasibilityId), eq(auditTrail.action, "delete")));
    expect(row).toBeTruthy();
    feasibilityId = 0; // already cleaned up by this delete — skip afterAll's own cleanup for this id
  });
});
