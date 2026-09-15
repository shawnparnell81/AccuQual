// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Covers the Sales & Marketing module: account CRUD + prospect -> active ->
// dormant workflow with sales_and_marketing-only gating, the append-only
// activity log (also the "Link to Sales Account" mechanism other modules
// use), quotes (draft -> submitted -> accepted|rejected -> archived) and
// contracts (draft -> active -> expired -> archived) sub-resource workflows,
// admin-only delete (deliberately narrower than Risk/Feasibility's
// admin-or-department rule — see sales.controller.ts's own comment), and a
// real "sales_account" context case in ai.assistant.ts (routed through
// POST /ai/assistant, not a dedicated pipeline, per the module's own locked
// decision).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray, and } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { salesAccounts, salesActivities, salesQuotes, salesContracts } from "../../src/drizzle/schema/sales.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
let accountId: number;
let quoteId: number;
let contractId: number;
const userIds: number[] = [];

let salesToken: string;
let qualityToken: string;
let engineeringToken: string;
let productionToken: string;
let adminToken: string;

async function makeUser(department: string | null, roleName = "operator") {
  const [user] = await db.insert(users).values({ tenantId, email: `sales-test-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName, department });
}

describe("Sales & Marketing module (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `Sales Test Tenant ${suffix}`, code: `sales-test-${suffix}` }).returning();
    tenantId = tenant!.id;

    salesToken = await makeUser("sales_and_marketing");
    qualityToken = await makeUser("quality");
    engineeringToken = await makeUser("engineering");
    productionToken = await makeUser("production"); // not in sales's PERMISSION_MATRIX at all
    adminToken = await makeUser(null, "admin");
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(inArray(auditTrail.performedBy, userIds));
    if (accountId) {
      await db.delete(salesActivities).where(eq(salesActivities.accountId, accountId));
      await db.delete(salesQuotes).where(eq(salesQuotes.accountId, accountId));
      await db.delete(salesContracts).where(eq(salesContracts.accountId, accountId));
      await db.delete(salesAccounts).where(eq(salesAccounts.id, accountId));
    }
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it("quality (read-only per the matrix) cannot create an account", async () => {
    const res = await request(app).post("/sales/accounts").set("Authorization", `Bearer ${qualityToken}`).send({ customerName: "x" });
    expect(res.status).toBe(403);
  });

  it("production (no matrix entry for sales at all) cannot create an account", async () => {
    const res = await request(app).post("/sales/accounts").set("Authorization", `Bearer ${productionToken}`).send({ customerName: "x" });
    expect(res.status).toBe(403);
  });

  it("sales_and_marketing can create an account", async () => {
    const res = await request(app).post("/sales/accounts").set("Authorization", `Bearer ${salesToken}`).send({ customerName: "Acme Fabrication", industry: "manufacturing" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("prospect");
    accountId = res.body.id;

    const [row] = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "SalesAccount"), eq(auditTrail.entityId, accountId), eq(auditTrail.action, "create")));
    expect(row).toBeTruthy();
  });

  it("quality CAN read the account (read access per the matrix)", async () => {
    const res = await request(app).get(`/sales/accounts/${accountId}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(200);
    expect(res.body.customerName).toBe("Acme Fabrication");
    expect(res.body.activities).toEqual([]);
  });

  it("quality cannot update the account — sales_and_marketing (or admin) only", async () => {
    const res = await request(app).put(`/sales/accounts/${accountId}`).set("Authorization", `Bearer ${qualityToken}`).send({ customerName: "hijacked" });
    expect(res.status).toBe(403);
  });

  it("cannot mark dormant before activating — sequence is enforced", async () => {
    const res = await request(app).post(`/sales/accounts/${accountId}/mark-dormant`).set("Authorization", `Bearer ${salesToken}`);
    expect(res.status).toBe(400);
  });

  it("sales_and_marketing drives the real account workflow: prospect -> active -> dormant", async () => {
    const activated = await request(app).post(`/sales/accounts/${accountId}/activate`).set("Authorization", `Bearer ${salesToken}`);
    expect(activated.status).toBe(200);
    expect(activated.body.status).toBe("active");

    const dormant = await request(app).post(`/sales/accounts/${accountId}/mark-dormant`).set("Authorization", `Bearer ${salesToken}`);
    expect(dormant.status).toBe(200);
    expect(dormant.body.status).toBe("dormant");

    const statusChanges = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "SalesAccount"), eq(auditTrail.entityId, accountId), eq(auditTrail.action, "status_change")));
    expect(statusChanges.length).toBe(2);
  });

  it("logs an activity — the same mechanism other modules' \"Link to Sales Account\" buttons use", async () => {
    const res = await request(app)
      .post(`/sales/accounts/${accountId}/activities`)
      .set("Authorization", `Bearer ${salesToken}`)
      .send({ activityType: "note", notes: "Linked from NCR #123", relatedSourceType: "NCR", relatedSourceId: 123 });
    expect(res.status).toBe(201);
    expect(res.body.relatedSourceType).toBe("NCR");

    const activities = await db.select().from(salesActivities).where(eq(salesActivities.accountId, accountId));
    expect(activities.length).toBe(1);
  });

  it("creates a quote with an auto-generated quote number", async () => {
    const res = await request(app).post(`/sales/accounts/${accountId}/quotes`).set("Authorization", `Bearer ${salesToken}`).send({});
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("draft");
    expect(res.body.quoteNumber).toBe(`Q-${res.body.id}`);
    quoteId = res.body.id;
  });

  it("cannot accept a quote straight from draft — must submit first", async () => {
    const res = await request(app).post(`/sales/accounts/${accountId}/quotes/${quoteId}/accept`).set("Authorization", `Bearer ${salesToken}`);
    expect(res.status).toBe(400);
  });

  it("drives the real quote workflow: draft -> submitted -> accepted -> archived", async () => {
    const submitted = await request(app).post(`/sales/accounts/${accountId}/quotes/${quoteId}/submit`).set("Authorization", `Bearer ${salesToken}`);
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe("submitted");

    const accepted = await request(app).post(`/sales/accounts/${accountId}/quotes/${quoteId}/accept`).set("Authorization", `Bearer ${salesToken}`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe("accepted");

    const archived = await request(app).post(`/sales/accounts/${accountId}/quotes/${quoteId}/archive`).set("Authorization", `Bearer ${salesToken}`);
    expect(archived.status).toBe(200);
    expect(archived.body.status).toBe("archived");
  });

  it("creates a contract and drives draft -> active -> expired -> archived", async () => {
    const created = await request(app).post(`/sales/accounts/${accountId}/contracts`).set("Authorization", `Bearer ${salesToken}`).send({ contractType: "customer" });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("draft");
    contractId = created.body.id;

    const active = await request(app).post(`/sales/accounts/${accountId}/contracts/${contractId}/activate`).set("Authorization", `Bearer ${salesToken}`);
    expect(active.status).toBe(200);
    expect(active.body.status).toBe("active");

    const expired = await request(app).post(`/sales/accounts/${accountId}/contracts/${contractId}/expire`).set("Authorization", `Bearer ${salesToken}`);
    expect(expired.status).toBe(200);
    expect(expired.body.status).toBe("expired");

    const archived = await request(app).post(`/sales/accounts/${accountId}/contracts/${contractId}/archive`).set("Authorization", `Bearer ${salesToken}`);
    expect(archived.status).toBe(200);
    expect(archived.body.status).toBe("archived");
  });

  it("the generic /ai/assistant endpoint answers with sales_account context (honest no-key stub in this test env), not a dedicated pipeline", async () => {
    const res = await request(app)
      .post("/ai/assistant")
      .set("Authorization", `Bearer ${salesToken}`)
      .send({ messages: [{ role: "user", content: "Summarize this account." }], context: { module: "sales_account", recordId: accountId } });
    expect(res.status).toBe(200);
    expect(res.body.content).toBeTruthy();

    const [row] = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "AiAssistantMessage"), eq(auditTrail.tenantId, tenantId)));
    expect((row?.changes as { module?: string })?.module).toBe("sales_account");
  });

  it("sales_and_marketing itself cannot delete — this module's delete rule is admin-only, no department at all", async () => {
    const res = await request(app).delete(`/sales/accounts/${accountId}`).set("Authorization", `Bearer ${salesToken}`);
    expect(res.status).toBe(403);
  });

  it("admin CAN delete, cascading its activities/quotes/contracts, logged before the row disappears", async () => {
    const res = await request(app).delete(`/sales/accounts/${accountId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(204);

    const [gone] = await db.select().from(salesAccounts).where(eq(salesAccounts.id, accountId));
    expect(gone).toBeUndefined();
    const remainingActivities = await db.select().from(salesActivities).where(eq(salesActivities.accountId, accountId));
    expect(remainingActivities.length).toBe(0);

    const [row] = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "SalesAccount"), eq(auditTrail.entityId, accountId), eq(auditTrail.action, "delete")));
    expect(row).toBeTruthy();
    accountId = 0; // already cleaned up by this delete — skip afterAll's own cleanup for this id
  });
});
