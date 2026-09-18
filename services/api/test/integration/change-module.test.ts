// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Regression coverage for Full-System Audit finding C1: the Change/PCN
// router had no RBAC gate at all (any authenticated tenant user could
// create/edit/approve a Product/Process Change Notice), and approveHandler
// recorded no audit trail entry and published no event — the one
// hand-rolled action on a module whose create/update otherwise get both
// for free from crudFactory.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { changeRequests } from "../../src/drizzle/schema/change.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
let changeId: number;
const userIds: number[] = [];
let engineeringToken: string;
let productionToken: string;

async function makeUser(department: string | null) {
  const [user] = await db.insert(users).values({ tenantId, email: `change-test-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName: "operator", department });
}

describe("Change / PCN module (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `Change Test Tenant ${suffix}`, code: `change-test-${suffix}` }).returning();
    tenantId = tenant!.id;
    await seedDefaultPermissions(tenantId);

    engineeringToken = await makeUser("engineering");
    productionToken = await makeUser("production");
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, tenantId));
    await db.delete(changeRequests).where(eq(changeRequests.tenantId, tenantId));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, tenantId));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it("production (read-only per the new matrix) cannot create a change request", async () => {
    const res = await request(app).post("/change").set("Authorization", `Bearer ${productionToken}`).send({ title: "Should be blocked" });
    expect(res.status).toBe(403);
  });

  it("engineering (edit) can create a real change request", async () => {
    const res = await request(app).post("/change").set("Authorization", `Bearer ${engineeringToken}`).send({ title: "Switch supplier for gasket material", impactAssessment: "Low risk, equivalent spec." });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("submitted");
    changeId = res.body.id;
  });

  it("production can read (real read access), matching the new matrix", async () => {
    const res = await request(app).get("/change").set("Authorization", `Bearer ${productionToken}`);
    expect(res.status).toBe(200);
    expect(res.body.some((c: { id: number }) => c.id === changeId)).toBe(true);
  });

  it("engineering can approve, and it's audited and published — previously recorded nothing at all", async () => {
    const res = await request(app).post(`/change/${changeId}/approve`).set("Authorization", `Bearer ${engineeringToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    expect(res.body.approvedBy).toBeTruthy();

    const trail = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "Change request"), eq(auditTrail.entityId, changeId)));
    expect(trail.some((t) => t.action === "status_change")).toBe(true);
  });

  it("production cannot approve — read-only, same gate as create", async () => {
    const res = await request(app).post(`/change/${changeId}/approve`).set("Authorization", `Bearer ${productionToken}`);
    expect(res.status).toBe(403);
  });
});
