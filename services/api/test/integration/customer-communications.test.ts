// Real-DB integration test (see tenant-isolation.test.ts's header comment
// for why this category exists). Covers the new Customer Contact &
// Communications Log module: real create/list/audit-trail, department RBAC
// (Customer Service/Quality: edit, everyone else: read), and tenant
// isolation on the real HTTP path — same battery
// tenant-isolation-modules.test.ts already applies to 6 other modules.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { customers } from "../../src/drizzle/schema/customers.js";
import { customerCommunications } from "../../src/drizzle/schema/customerCommunications.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
let otherTenantId: number;
let customerId: number;
let otherTenantCustomerId: number | undefined;
const userIds: number[] = [];
let customerServiceToken: string;
let qualityToken: string;
let purchasingToken: string;

async function makeUser(forTenantId: number, department: string | null, roleName = "operator") {
  const [user] = await db.insert(users).values({ tenantId: forTenantId, email: `cc-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), tenantId: forTenantId, roleId: null, roleName, department });
}

describe("Customer Communications (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `CC Test Tenant ${suffix}`, code: `cc-test-${suffix}` }).returning();
    tenantId = tenant!.id;
    const [other] = await db.insert(tenants).values({ name: `CC Other Tenant ${suffix}`, code: `cc-other-${suffix}` }).returning();
    otherTenantId = other!.id;
    await seedDefaultPermissions(tenantId);
    await seedDefaultPermissions(otherTenantId);

    const [customer] = await db.insert(customers).values({ tenantId, legalName: `Test Customer Inc. ${suffix}` }).returning();
    customerId = customer!.id;

    customerServiceToken = await makeUser(tenantId, "customer_service");
    qualityToken = await makeUser(tenantId, "quality");
    purchasingToken = await makeUser(tenantId, "purchasing");
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(inArray(auditTrail.tenantId, [tenantId, otherTenantId]));
    await db.delete(customerCommunications).where(inArray(customerCommunications.tenantId, [tenantId, otherTenantId]));
    await db.delete(customers).where(eq(customers.id, customerId));
    if (otherTenantCustomerId) await db.delete(customers).where(eq(customers.id, otherTenantCustomerId));
    await db.delete(departmentPermissions).where(inArray(departmentPermissions.tenantId, [tenantId, otherTenantId]));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(tenants).where(inArray(tenants.id, [tenantId, otherTenantId]));
    await pool.end();
  });

  it("Customer Service can create a real communication log entry", async () => {
    const res = await request(app)
      .post("/customer-communications")
      .set("Authorization", `Bearer ${customerServiceToken}`)
      .send({ customerId, commsType: "phone", subject: "Delivery delay", summary: "Called re: late shipment.", followUpRequired: true });
    expect(res.status).toBe(201);
    expect(res.body.customerId).toBe(customerId);
    expect(res.body.followUpRequired).toBe(true);

    const trail = await db.select().from(auditTrail).where(eq(auditTrail.entityType, "CustomerCommunication"));
    expect(trail.some((t) => t.entityId === res.body.id && t.action === "create")).toBe(true);
  });

  it("Quality can also create and edit — the second department this module grants edit to", async () => {
    const res = await request(app)
      .post("/customer-communications")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ customerId, commsType: "email", summary: "Sent root-cause explanation for NCR-linked defect." });
    expect(res.status).toBe(201);

    const patch = await request(app).patch(`/customer-communications/${res.body.id}`).set("Authorization", `Bearer ${qualityToken}`).send({ summary: "Updated: customer confirmed receipt." });
    expect(patch.status).toBe(200);
    expect(patch.body.summary).toBe("Updated: customer confirmed receipt.");
  });

  it("a read-only department (Purchasing) can list but not create", async () => {
    const list = await request(app).get("/customer-communications").set("Authorization", `Bearer ${purchasingToken}`);
    expect(list.status).toBe(200);

    const create = await request(app).post("/customer-communications").set("Authorization", `Bearer ${purchasingToken}`).send({ customerId, commsType: "email", summary: "should be blocked" });
    expect(create.status).toBe(403);
  });

  it("rejects an invalid commsType", async () => {
    const res = await request(app).post("/customer-communications").set("Authorization", `Bearer ${customerServiceToken}`).send({ customerId, commsType: "carrier_pigeon", summary: "x" });
    expect(res.status).toBe(400);
  });

  it("rejects an absurd/malformed date with a clean 400, not a real crash — a live-reproduced bug (z.coerce.date() alone accepts a mistyped '91920-02-06' as a real year-91920 Date, which then crashed at the Postgres layer)", async () => {
    const res = await request(app)
      .post("/customer-communications")
      .set("Authorization", `Bearer ${customerServiceToken}`)
      .send({ customerId, commsType: "phone", summary: "x", followUpDate: "91920-02-06" });
    expect(res.status).toBe(400);
  });

  it("never shows another tenant's communications, and cross-tenant writes 404", async () => {
    const [otherCustomer] = await db.insert(customers).values({ tenantId: otherTenantId, legalName: "Other Tenant Customer" }).returning();
    otherTenantCustomerId = otherCustomer!.id;
    const otherToken = await makeUser(otherTenantId, "customer_service");
    const otherLog = await request(app).post("/customer-communications").set("Authorization", `Bearer ${otherToken}`).send({ customerId: otherCustomer!.id, commsType: "phone", summary: "other tenant's log" });
    expect(otherLog.status).toBe(201);

    const list = await request(app).get("/customer-communications").set("Authorization", `Bearer ${customerServiceToken}`);
    expect(list.body.find((c: { id: number }) => c.id === otherLog.body.id)).toBeUndefined();

    const crossPatch = await request(app).patch(`/customer-communications/${otherLog.body.id}`).set("Authorization", `Bearer ${customerServiceToken}`).send({ summary: "hacked" });
    expect(crossPatch.status).toBe(404);
  });
});
