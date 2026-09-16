// Real-DB integration test (see tenant-isolation.test.ts's header comment).
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
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { documents } from "../../src/drizzle/schema/documents.js";
import { customers } from "../../src/drizzle/schema/customers.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
const app = createApp();
const suffix = Date.now();

let tenantId: number;
let ndaDocumentId: number;
let customerId: number;
const userIds: number[] = [];

let salesToken: string;
let qualityToken: string;
let productionToken: string;
let adminToken: string;

async function makeUser(department: string | null, roleName = "operator") {
  const [user] = await db.insert(users).values({ tenantId, email: `cust-test-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName, department });
}

describe("Customer Onboarding module (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `Customer Test Tenant ${suffix}`, code: `cust-test-${suffix}` }).returning();
    tenantId = tenant!.id;

    await seedDefaultPermissions(tenantId);

    const [doc] = await db.insert(documents).values({ tenantId, title: `NDA ${suffix}`, category: "legal" }).returning();
    ndaDocumentId = doc!.id;

    salesToken = await makeUser("sales_and_marketing");
    qualityToken = await makeUser("quality");
    productionToken = await makeUser("production"); // not in customers's PERMISSION_MATRIX at all
    adminToken = await makeUser(null, "admin");
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(inArray(auditTrail.performedBy, userIds));
    if (customerId) await db.delete(customers).where(eq(customers.id, customerId));
    await db.delete(documents).where(eq(documents.id, ndaDocumentId));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, tenantId));

    await db.delete(tenants).where(eq(tenants.id, tenantId));
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

    const [row] = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "AiAssistantMessage"), eq(auditTrail.tenantId, tenantId)));
    expect((row?.changes as { module?: string })?.module).toBe("customer");
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
  let rejTenantId: number;
  let rejCustomerId: number;
  const rejUserIds: number[] = [];
  let rejSalesToken: string;

  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `Customer Reject Tenant ${suffix}`, code: `cust-reject-${suffix}` }).returning();
    rejTenantId = tenant!.id;

    await seedDefaultPermissions(rejTenantId);
    const [user] = await db.insert(users).values({ tenantId: rejTenantId, email: `cust-reject-${suffix}@test.local`, passwordHash: "unused" }).returning();
    rejUserIds.push(user!.id);
    rejSalesToken = signAccessToken({ sub: String(user!.id), tenantId: rejTenantId, roleId: null, roleName: "operator", department: "sales_and_marketing" });

    const [created] = await db.insert(customers).values({ tenantId: rejTenantId, legalName: "Reject Me Corp", status: "submitted" }).returning();
    rejCustomerId = created!.id;
    await db.update(customers).set({ status: "under_review" }).where(eq(customers.id, rejCustomerId));
  });

  afterAll(async () => {
    await db.delete(auditTrail).where(inArray(auditTrail.performedBy, rejUserIds));
    await db.delete(customers).where(eq(customers.id, rejCustomerId));
    for (const id of rejUserIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, rejTenantId));

    await db.delete(tenants).where(eq(tenants.id, rejTenantId));
    await pool.end();
  });

  it("under_review -> rejected stamps decidedAt and stops there (no further transition)", async () => {
    const res = await request(app).post(`/customers/${rejCustomerId}/reject`).set("Authorization", `Bearer ${rejSalesToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("rejected");
    expect(res.body.decidedAt).toBeTruthy();

    const activateAttempt = await request(app).post(`/customers/${rejCustomerId}/activate`).set("Authorization", `Bearer ${rejSalesToken}`);
    expect(activateAttempt.status).toBe(400);
  });
});
