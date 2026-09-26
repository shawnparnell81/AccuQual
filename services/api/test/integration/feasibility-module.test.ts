import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Covers the rebuilt bespoke Feasibility Review ("Contract & Project
// Feasibility Review Form", QMS-FR-001 — see feasibility.ts's own schema
// comment): engineering-owned full-record edit, the 5 fixed sign-off rows
// (each owned by a different department, server-stamped sign-off dates),
// finalize, and delete. Settings-driven behavior (defaultRiskLevel,
// autoAssignOwner, requiredDocuments, notificationsEnabled) is covered in
// settings-module.test.ts, not duplicated here.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray, and } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { feasibilityReviews } from "../../src/drizzle/schema/feasibility.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
const app = createApp();
const suffix = Date.now();

let companyId: number;
let reviewId: number;
const userIds: number[] = [];

let engineeringToken: string;
let qualityToken: string;
let productionToken: string;
let purchasingToken: string;
let salesToken: string;
let customerServiceToken: string;
let adminToken: string;

async function makeUser(department: string | null, roleName = "operator") {
  const [user] = await db.insert(users).values({ email: `feas-test-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused", department }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName, department });
}

describe("Feasibility Review — bespoke document (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;

    await seedDefaultPermissions(companyId);

    engineeringToken = await makeUser("engineering");
    qualityToken = await makeUser("quality");
    productionToken = await makeUser("production");
    purchasingToken = await makeUser("purchasing");
    salesToken = await makeUser("sales_and_marketing");
    customerServiceToken = await makeUser("customer_service"); // not in feasibility's PERMISSION_MATRIX at all
    adminToken = await makeUser(null, "admin");
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("customer_service (no matrix entry at all) cannot create a review", async () => {
    const res = await request(app).post("/feasibility").set("Authorization", `Bearer ${customerServiceToken}`).send({});
    expect(res.status).toBe(403);
  });

  it("quality cannot create a review — only engineering or sales_and_marketing", async () => {
    const res = await request(app).post("/feasibility").set("Authorization", `Bearer ${qualityToken}`).send({});
    expect(res.status).toBe(403);
  });

  it("engineering creates a review", async () => {
    const res = await request(app).post("/feasibility").set("Authorization", `Bearer ${engineeringToken}`).send({ customerName: "Acme Corp", partProjectName: "Bracket Assy Rev C" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("draft");
    expect(res.body.customerName).toBe("Acme Corp");
    reviewId = res.body.id;

    const [row] = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "FeasibilityReview"), eq(auditTrail.entityId, reviewId), eq(auditTrail.action, "create")));
    expect(row).toBeTruthy();
  });

  it("quality cannot edit the main record — only engineering or admin", async () => {
    const res = await request(app).put(`/feasibility/${reviewId}`).set("Authorization", `Bearer ${qualityToken}`).send({ customerName: "hijacked" });
    expect(res.status).toBe(403);
  });

  it("engineering fills the 7-area assessment", async () => {
    const res = await request(app)
      .put(`/feasibility/${reviewId}`)
      .set("Authorization", `Bearer ${engineeringToken}`)
      .send({ designFeasible: "yes", designRiskLevel: "low", designMitigation: "None required", financialFeasible: "partial", financialRiskLevel: "high", financialMitigation: "Renegotiate tooling cost" });
    expect(res.status).toBe(200);
    expect(res.body.designFeasible).toBe("yes");
    expect(res.body.financialRiskLevel).toBe("high");
  });

  it("quality can sign its own row but not another department's", async () => {
    const ownRow = await request(app).patch(`/feasibility/${reviewId}/signoff`).set("Authorization", `Bearer ${qualityToken}`).send({ qualitySignoffName: "J. Chen, QA Manager", qualitySignoffSignature: "J. Chen" });
    expect(ownRow.status).toBe(200);
    expect(ownRow.body.qualitySignoffSignature).toBe("J. Chen");
    expect(ownRow.body.qualitySignoffDate).toBeTruthy(); // server-stamped the moment it transitioned unset -> set

    const otherRow = await request(app).patch(`/feasibility/${reviewId}/signoff`).set("Authorization", `Bearer ${qualityToken}`).send({ purchasingSignoffName: "hijacked", purchasingSignoffSignature: "hijacked" });
    expect(otherRow.status).toBe(403);
  });

  it("production signs the Manufacturing / Operations row, purchasing and sales sign theirs", async () => {
    const manufacturing = await request(app).patch(`/feasibility/${reviewId}/signoff`).set("Authorization", `Bearer ${productionToken}`).send({ manufacturingSignoffName: "R. Diaz", manufacturingSignoffSignature: "R. Diaz" });
    expect(manufacturing.status).toBe(200);

    const purchasing = await request(app).patch(`/feasibility/${reviewId}/signoff`).set("Authorization", `Bearer ${purchasingToken}`).send({ purchasingSignoffName: "T. Nguyen", purchasingSignoffSignature: "T. Nguyen" });
    expect(purchasing.status).toBe(200);

    const sales = await request(app).patch(`/feasibility/${reviewId}/signoff`).set("Authorization", `Bearer ${salesToken}`).send({ salesSignoffName: "M. Patel", salesSignoffSignature: "M. Patel" });
    expect(sales.status).toBe(200);
  });

  it("engineering signs its own row and sets the determination", async () => {
    const signoff = await request(app).patch(`/feasibility/${reviewId}/signoff`).set("Authorization", `Bearer ${engineeringToken}`).send({ engineeringSignoffName: "A. Osei", engineeringSignoffSignature: "A. Osei" });
    expect(signoff.status).toBe(200);

    const determination = await request(app).put(`/feasibility/${reviewId}`).set("Authorization", `Bearer ${engineeringToken}`).send({ determination: "feasible_with_conditions", determinationNotes: "Subject to a 6-week tooling lead time." });
    expect(determination.status).toBe(200);
    expect(determination.body.determination).toBe("feasible_with_conditions");
  });

  it("quality cannot finalize — only engineering or admin", async () => {
    const res = await request(app).post(`/feasibility/${reviewId}/finalize`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(403);
  });

  it("engineering finalizes — status becomes final, further edits are rejected", async () => {
    const res = await request(app).post(`/feasibility/${reviewId}/finalize`).set("Authorization", `Bearer ${engineeringToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("final");
    expect(res.body.finalizedAt).toBeTruthy();

    const editAfterFinal = await request(app).put(`/feasibility/${reviewId}`).set("Authorization", `Bearer ${engineeringToken}`).send({ customerName: "too late" });
    expect(editAfterFinal.status).toBe(400);

    const signoffAfterFinal = await request(app).patch(`/feasibility/${reviewId}/signoff`).set("Authorization", `Bearer ${qualityToken}`).send({ qualitySignoffSignature: "changed" });
    expect(signoffAfterFinal.status).toBe(400);
  });

  it("the generic /ai/assistant endpoint answers with feasibility context (honest no-key stub in this test env)", async () => {
    const res = await request(app)
      .post("/ai/assistant")
      .set("Authorization", `Bearer ${engineeringToken}`)
      .send({ messages: [{ role: "user", content: "Summarize this feasibility review." }], context: { module: "feasibility", recordId: reviewId } });
    expect(res.status).toBe(200);
    expect(res.body.content).toBeTruthy();
  });

  it("quality cannot delete — only engineering or admin", async () => {
    const res = await request(app).delete(`/feasibility/${reviewId}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(403);
  });

  it("engineering deletes, logged before the row disappears", async () => {
    const res = await request(app).delete(`/feasibility/${reviewId}`).set("Authorization", `Bearer ${engineeringToken}`);
    expect(res.status).toBe(204);

    const [gone] = await db.select().from(feasibilityReviews).where(eq(feasibilityReviews.id, reviewId));
    expect(gone).toBeUndefined();

    const [row] = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "FeasibilityReview"), eq(auditTrail.entityId, reviewId), eq(auditTrail.action, "delete")));
    expect(row).toBeTruthy();
    reviewId = 0; // already cleaned up by this delete — skip afterAll's own cleanup for this id
  });
});
