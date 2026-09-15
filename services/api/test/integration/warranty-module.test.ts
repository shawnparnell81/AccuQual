// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Covers the Warranty module end to end: create (Customer Service intake),
// the full new -> inspection -> supplier_review -> approved -> replaced ->
// closed lifecycle plus the rejected -> closed branch, department gating on
// each transition, cost tracking with a real recomputed running total, a
// document upload landing in the shared `attachments` table (not a second
// parallel table — see warranty.ts's own schema comment), and the
// analytics rollup.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, and } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { customers } from "../../src/drizzle/schema/customers.js";
import { warrantyClaims, warrantyClaimCosts, warrantyClaimWorkflow } from "../../src/drizzle/schema/warranty.js";
import { attachments } from "../../src/drizzle/schema/attachments.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
let customerId: number;
let customerServiceToken: string;
let qualityToken: string;
let engineeringToken: string;
let purchasingToken: string;
let claimId: number;
let secondClaimId: number;

async function makeUser(department: string | null, roleName = "operator") {
  const [user] = await db
    .insert(users)
    .values({ tenantId, email: `warranty-test-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused", department })
    .returning();
  return signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName, department });
}

describe("Warranty module (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `Warranty Test Tenant ${suffix}`, code: `warranty-test-${suffix}` }).returning();
    tenantId = tenant!.id;

    customerServiceToken = await makeUser("customer_service");
    qualityToken = await makeUser("quality");
    engineeringToken = await makeUser("engineering");
    purchasingToken = await makeUser("purchasing");

    const [customer] = await db.insert(customers).values({ tenantId, legalName: `Warranty Test Customer ${suffix}`, status: "active" }).returning();
    customerId = customer!.id;
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, tenantId));
    await db.delete(attachments).where(eq(attachments.tenantId, tenantId));
    await db.delete(warrantyClaimWorkflow).where(eq(warrantyClaimWorkflow.tenantId, tenantId));
    await db.delete(warrantyClaimCosts).where(eq(warrantyClaimCosts.tenantId, tenantId));
    await db.delete(warrantyClaims).where(eq(warrantyClaims.tenantId, tenantId));
    await db.delete(customers).where(eq(customers.tenantId, tenantId));
    await db.delete(users).where(eq(users.tenantId, tenantId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it("purchasing cannot create a claim — intake is customer_service/quality only", async () => {
    const res = await request(app).post("/warranty/claims").set("Authorization", `Bearer ${purchasingToken}`).send({ customerId, failureDescription: "Unit won't power on" });
    expect(res.status).toBe(403);
  });

  it("customer_service creates a claim, gets a real claim number, and a 'new' workflow entry", async () => {
    const res = await request(app)
      .post("/warranty/claims")
      .set("Authorization", `Bearer ${customerServiceToken}`)
      .send({ customerId, serialNumber: "SN-12345", failureDescription: "Unit won't power on", warrantyCostEstimate: 150 });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("new");
    expect(res.body.claimNumber).toMatch(/^WC-\d{6}$/);
    claimId = res.body.id;

    const workflow = await db.select().from(warrantyClaimWorkflow).where(eq(warrantyClaimWorkflow.claimId, claimId));
    expect(workflow).toHaveLength(1);
    expect(workflow[0]!.toStatus).toBe("new");
  });

  it("rejects an invalid customerId with a clean 400, not a raw FK violation", async () => {
    const res = await request(app).post("/warranty/claims").set("Authorization", `Bearer ${qualityToken}`).send({ customerId: 999999, failureDescription: "x" });
    expect(res.status).toBe(400);
  });

  it("cannot skip a status (new -> approved)", async () => {
    const res = await request(app).post(`/warranty/claims/${claimId}/transition`).set("Authorization", `Bearer ${qualityToken}`).send({ status: "approved" });
    expect(res.status).toBe(400);
  });

  it("purchasing (read-only) cannot move new -> inspection", async () => {
    const res = await request(app).post(`/warranty/claims/${claimId}/transition`).set("Authorization", `Bearer ${purchasingToken}`).send({ status: "inspection" });
    expect(res.status).toBe(403);
  });

  it("engineering can move new -> inspection", async () => {
    const res = await request(app).post(`/warranty/claims/${claimId}/transition`).set("Authorization", `Bearer ${engineeringToken}`).send({ status: "inspection", note: "Bench inspection scheduled" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("inspection");
  });

  it("POST .../update records inspection findings", async () => {
    const res = await request(app)
      .post(`/warranty/claims/${claimId}/update`)
      .set("Authorization", `Bearer ${engineeringToken}`)
      .send({ inspectionNotes: "Failed capacitor on main board", inspectionDate: new Date().toISOString() });
    expect(res.status).toBe(200);
    expect(res.body.inspectionNotes).toBe("Failed capacitor on main board");
  });

  it("uploads a failure photo — lands in the shared attachments table, tagged to this claim, and is indexed onto the claim's own failureImages field", async () => {
    const res = await request(app)
      .post(`/warranty/claims/${claimId}/upload`)
      .set("Authorization", `Bearer ${engineeringToken}`)
      .field("category", "failure_image")
      .field("caption", "Burnt capacitor")
      .attach("file", Buffer.from("fake jpeg bytes"), "failure.jpg");
    expect(res.status).toBe(201);
    expect(res.body.claim.failureImages).toHaveLength(1);
    expect(res.body.claim.failureImages[0].caption).toBe("Burnt capacitor");

    const [attachmentRow] = await db.select().from(attachments).where(eq(attachments.id, res.body.attachment.id));
    expect(attachmentRow!.entityType).toBe("warranty_claim");
    expect(attachmentRow!.entityId).toBe(claimId);
  });

  it("moves to supplier_review, then only quality may approve/reject", async () => {
    const toReview = await request(app).post(`/warranty/claims/${claimId}/transition`).set("Authorization", `Bearer ${engineeringToken}`).send({ status: "supplier_review" });
    expect(toReview.status).toBe(200);

    const engineeringTriesApprove = await request(app).post(`/warranty/claims/${claimId}/transition`).set("Authorization", `Bearer ${engineeringToken}`).send({ status: "approved" });
    expect(engineeringTriesApprove.status).toBe(403);

    const approved = await request(app).post(`/warranty/claims/${claimId}/transition`).set("Authorization", `Bearer ${qualityToken}`).send({ status: "approved" });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("approved");
  });

  it("records cost entries and recomputes warrantyActualCost as a real running sum", async () => {
    const first = await request(app).post(`/warranty/claims/${claimId}/costs`).set("Authorization", `Bearer ${qualityToken}`).send({ costType: "parts", amount: 45.5 });
    expect(first.status).toBe(201);
    const second = await request(app).post(`/warranty/claims/${claimId}/costs`).set("Authorization", `Bearer ${purchasingToken}`).send({ costType: "shipping", amount: 12.25 });
    expect(second.status).toBe(201);

    const detail = await request(app).get(`/warranty/claims/${claimId}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(Number(detail.body.warrantyActualCost)).toBeCloseTo(57.75);
    expect(detail.body.costs).toHaveLength(2);
  });

  it("engineering cannot record a cost entry — parts/purchasing money-side only", async () => {
    const res = await request(app).post(`/warranty/claims/${claimId}/costs`).set("Authorization", `Bearer ${engineeringToken}`).send({ costType: "labor", amount: 20 });
    expect(res.status).toBe(403);
  });

  it("moves through replaced -> closed; closed claims can no longer be edited", async () => {
    const replaced = await request(app).post(`/warranty/claims/${claimId}/transition`).set("Authorization", `Bearer ${qualityToken}`).send({ status: "replaced" });
    expect(replaced.status).toBe(200);
    const closed = await request(app).post(`/warranty/claims/${claimId}/transition`).set("Authorization", `Bearer ${qualityToken}`).send({ status: "closed" });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("closed");

    const editAttempt = await request(app).post(`/warranty/claims/${claimId}/update`).set("Authorization", `Bearer ${qualityToken}`).send({ dispositionNotes: "too late" });
    expect(editAttempt.status).toBe(400);
  });

  it("a second claim can take the rejected -> closed branch", async () => {
    const created = await request(app).post("/warranty/claims").set("Authorization", `Bearer ${customerServiceToken}`).send({ customerId, failureDescription: "Cosmetic defect only" });
    secondClaimId = created.body.id;
    await request(app).post(`/warranty/claims/${secondClaimId}/transition`).set("Authorization", `Bearer ${qualityToken}`).send({ status: "inspection" });
    await request(app).post(`/warranty/claims/${secondClaimId}/transition`).set("Authorization", `Bearer ${qualityToken}`).send({ status: "supplier_review" });
    const rejected = await request(app).post(`/warranty/claims/${secondClaimId}/transition`).set("Authorization", `Bearer ${qualityToken}`).send({ status: "rejected" });
    expect(rejected.status).toBe(200);
    const closed = await request(app).post(`/warranty/claims/${secondClaimId}/transition`).set("Authorization", `Bearer ${qualityToken}`).send({ status: "closed" });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("closed");
  });

  it("GET /warranty/analytics reports real counts, cost totals, and average time-in-status", async () => {
    const res = await request(app).get("/warranty/analytics").set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(200);
    expect(res.body.totalClaims).toBe(2);
    expect(res.body.byStatus.closed).toBe(2);
    expect(Number(res.body.totalActualCost)).toBeCloseTo(57.75);
    expect(res.body.averageDaysInStatus).toBeTypeOf("object");
  });

  it("every real transition is in the audit trail as a status_change", async () => {
    const rows = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "WarrantyClaim"), eq(auditTrail.entityId, claimId), eq(auditTrail.action, "status_change")));
    // new->inspection, inspection->supplier_review, supplier_review->approved, approved->replaced, replaced->closed
    expect(rows.length).toBe(5);
  });
});
