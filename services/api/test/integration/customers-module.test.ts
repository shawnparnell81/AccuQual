import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Covers the Customer Onboarding module: full CRUD, department gating
// (sales_and_marketing-only create/edit, quality/engineering read-only, no
// access at all for other departments), the draft -> submitted ->
// under_review -> approved -> activated (or -> rejected) workflow with
// decidedAt/activatedAt stamping, linking an existing Document Control
// record as the NDA, admin-only delete (narrower than Risk/Feasibility's
// quality-or-admin rule — same stricter pattern as Sales & Marketing), and a
// real "customer" context case in ai.assistant.ts (routed through
// POST /ai/assistant, not a dedicated pipeline).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray, and } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { documents } from "../../src/drizzle/schema/documents.js";
import { customers } from "../../src/drizzle/schema/customers.js";
import { customerScorecards } from "../../src/drizzle/schema/customerScorecards.js";
import { warrantyClaims } from "../../src/drizzle/schema/warranty.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
const app = createApp();
const suffix = Date.now();

let companyId: number;
let ndaDocumentId: number;
let customerId: number;
// A separate, disposable customer for the scorecard tests below — kept
// independent of `customerId`'s own lifecycle (which the "admin CAN
// delete" test further down deletes) so those tests can't interact with
// this file's existing delete-flow coverage.
let scorecardCustomerId: number;
const userIds: number[] = [];

let salesToken: string;
let qualityToken: string;
let productionToken: string;
let adminToken: string;

async function makeUser(department: string | null, roleName = "operator") {
  const [user] = await db.insert(users).values({ email: `cust-test-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName, department });
}

describe("Customer Onboarding module (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;

    await seedDefaultPermissions(companyId);

    const [doc] = await db.insert(documents).values({ title: `NDA ${suffix}`, category: "legal" }).returning();
    ndaDocumentId = doc!.id;

    salesToken = await makeUser("sales_and_marketing");
    qualityToken = await makeUser("quality");
    productionToken = await makeUser("production"); // not in customers's PERMISSION_MATRIX at all
    adminToken = await makeUser(null, "admin");

    const [scorecardCustomer] = await db.insert(customers).values({ legalName: `Scorecard Test Customer ${suffix}` }).returning();
    scorecardCustomerId = scorecardCustomer!.id;
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    // Pool is closed in the second describe block's afterAll below — this
    // file has two describe blocks sharing one pool, so only the LAST one
    // to run may end it.
  });

  it("quality (read-only per the matrix) cannot create a customer", async () => {
    const res = await request(app).post("/customers").set("Authorization", `Bearer ${qualityToken}`).send({ legalName: "x" });
    expect(res.status).toBe(403);
  });

  it("production (no matrix entry for customers at all) cannot create a customer", async () => {
    const res = await request(app).post("/customers").set("Authorization", `Bearer ${productionToken}`).send({ legalName: "x" });
    expect(res.status).toBe(403);
  });

  it("sales_and_marketing can create a customer, linked to a real Sales Account", async () => {
    const res = await request(app)
      .post("/customers")
      .set("Authorization", `Bearer ${salesToken}`)
      .send({ legalName: "Acme Fabrication Co", industry: "manufacturing", customerType: "OEM", relatedSourceType: "SalesAccount", relatedSourceId: 999 });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("draft");
    customerId = res.body.id;

    const [row] = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "Customer"), eq(auditTrail.entityId, customerId), eq(auditTrail.action, "create")));
    expect(row).toBeTruthy();
  });

  it("quality CAN read the customer (read access per the matrix)", async () => {
    const res = await request(app).get(`/customers/${customerId}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(200);
    expect(res.body.legalName).toBe("Acme Fabrication Co");
  });

  it("quality cannot update the customer — sales_and_marketing (or admin) only", async () => {
    const res = await request(app).put(`/customers/${customerId}`).set("Authorization", `Bearer ${qualityToken}`).send({ legalName: "hijacked" });
    expect(res.status).toBe(403);
  });

  it("sales_and_marketing can attach the NDA (an existing real Document Control record)", async () => {
    const res = await request(app).put(`/customers/${customerId}`).set("Authorization", `Bearer ${salesToken}`).send({ ndaDocumentId });
    expect(res.status).toBe(200);
    expect(res.body.ndaDocumentId).toBe(ndaDocumentId);
  });

  it("cannot skip the workflow — draft straight to approved is rejected", async () => {
    const res = await request(app).post(`/customers/${customerId}/approve`).set("Authorization", `Bearer ${salesToken}`);
    expect(res.status).toBe(400);
  });

  it("production cannot drive the workflow forward — sales_and_marketing only", async () => {
    const res = await request(app).post(`/customers/${customerId}/submit`).set("Authorization", `Bearer ${productionToken}`);
    expect(res.status).toBe(403);
  });

  it("drives the real workflow: draft -> submitted -> under_review -> approved -> activated", async () => {
    const submitted = await request(app).post(`/customers/${customerId}/submit`).set("Authorization", `Bearer ${salesToken}`);
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe("submitted");

    const underReview = await request(app).post(`/customers/${customerId}/review`).set("Authorization", `Bearer ${salesToken}`);
    expect(underReview.status).toBe(200);
    expect(underReview.body.status).toBe("under_review");

    const approved = await request(app).post(`/customers/${customerId}/approve`).set("Authorization", `Bearer ${salesToken}`);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("approved");
    expect(approved.body.decidedAt).toBeTruthy();

    const activated = await request(app).post(`/customers/${customerId}/activate`).set("Authorization", `Bearer ${salesToken}`);
    expect(activated.status).toBe(200);
    expect(activated.body.status).toBe("activated");
    expect(activated.body.activatedAt).toBeTruthy();

    const statusChanges = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "Customer"), eq(auditTrail.entityId, customerId), eq(auditTrail.action, "status_change")));
    expect(statusChanges.length).toBe(4); // submit, review, approve, activate
  });

  it("cannot activate twice — already activated is a terminal state for this transition map", async () => {
    const res = await request(app).post(`/customers/${customerId}/activate`).set("Authorization", `Bearer ${salesToken}`);
    expect(res.status).toBe(400);
  });

  it("the generic /ai/assistant endpoint answers with customer context (honest no-key stub in this test env), not a dedicated pipeline", async () => {
    const res = await request(app)
      .post("/ai/assistant")
      .set("Authorization", `Bearer ${salesToken}`)
      .send({ messages: [{ role: "user", content: "Summarize this customer." }], context: { module: "customer", recordId: customerId } });
    expect(res.status).toBe(200);
    expect(res.body.content).toBeTruthy();

    const [row] = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "AiAssistantMessage")));
    expect((row?.changes as { module?: string })?.module).toBe("customer");
  });

  // Customer Scorecard — same manually-entered shape as the Suppliers
  // module's own scorecard, on a separate disposable customer (see
  // scorecardCustomerId's own comment) so these tests never interact with
  // customerId's delete-flow coverage below.
  describe("Customer Scorecard", () => {
    it("quality (read-only per the matrix) cannot add a scorecard entry", async () => {
      const res = await request(app).post(`/customers/${scorecardCustomerId}/scorecard`).set("Authorization", `Bearer ${qualityToken}`).send({ period: "2026-Q1", qualityScore: 80, deliveryScore: 80 });
      expect(res.status).toBe(403);
    });

    it("sales_and_marketing can add a real scorecard entry, and it's audited", async () => {
      const res = await request(app)
        .post(`/customers/${scorecardCustomerId}/scorecard`)
        .set("Authorization", `Bearer ${salesToken}`)
        .send({ period: "2026-Q1", qualityScore: 90, deliveryScore: 70, notes: "Late on two shipments this quarter." });
      expect(res.status).toBe(201);
      expect(res.body.overallScore).toBe("80");

      const trail = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "CustomerScorecard"), eq(auditTrail.entityId, res.body.id)));
      expect(trail.some((t) => t.action === "create")).toBe(true);
    });

    it("quality CAN read the scorecard history (read access per the matrix)", async () => {
      const res = await request(app).get(`/customers/${scorecardCustomerId}/scorecard`).set("Authorization", `Bearer ${qualityToken}`);
      expect(res.status).toBe(200);
      expect(res.body.some((r: { period: string }) => r.period === "2026-Q1")).toBe(true);
    });

    it("production (no matrix entry for customers at all) cannot even read the scorecard", async () => {
      const res = await request(app).get(`/customers/${scorecardCustomerId}/scorecard`).set("Authorization", `Bearer ${productionToken}`);
      expect(res.status).toBe(403);
    });

    it("scorecard-summary reflects a real linked warranty claim, not a fabricated score", async () => {
      const zero = await request(app).get(`/customers/${scorecardCustomerId}/scorecard-summary`).set("Authorization", `Bearer ${qualityToken}`);
      expect(zero.body).toEqual({ warrantyClaimCount: 0, crarCount: 0, feasibilityReviewCount: 0 });

      await db.insert(warrantyClaims).values({ claimNumber: `WC-CUST-TEST-${suffix}`, customerId: scorecardCustomerId });
      const withClaim = await request(app).get(`/customers/${scorecardCustomerId}/scorecard-summary`).set("Authorization", `Bearer ${qualityToken}`);
      expect(withClaim.body.warrantyClaimCount).toBe(1);
    });
  });

  it("sales_and_marketing itself cannot delete — this module's delete rule is admin-only, no department at all", async () => {
    const res = await request(app).delete(`/customers/${customerId}`).set("Authorization", `Bearer ${salesToken}`);
    expect(res.status).toBe(403);
  });

  it("admin CAN delete, logged before the row disappears", async () => {
    const res = await request(app).delete(`/customers/${customerId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(204);

    const [gone] = await db.select().from(customers).where(eq(customers.id, customerId));
    expect(gone).toBeUndefined();

    const [row] = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "Customer"), eq(auditTrail.entityId, customerId), eq(auditTrail.action, "delete")));
    expect(row).toBeTruthy();
    customerId = 0; // already cleaned up by this delete — skip afterAll's own cleanup for this id
  });
});

describe("Customer Onboarding — rejection path", () => {
  
  
  const rejUserIds: number[] = [];
  

  beforeAll(async () => {
    
    

    
    
    
    

    
    
    
  });

  afterAll(async () => {
    await pool.end();
  });

  it("under_review -> rejected stamps decidedAt and stops there (no further transition)", async () => {
    
    
    
    

    
    
  });
});
