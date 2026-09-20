// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Full-System Audit finding M8 (highest priority in that finding's list):
// system-health had zero test coverage — no RBAC check on the admin-only
// gate, and no coverage of any of its 7 sub-checks' real aggregation logic.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { inventoryItems, inventoryAlerts } from "../../src/drizzle/schema/inventory.js";
import { notificationLog } from "../../src/drizzle/schema/notifications.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
let otherTenantId: number;
const userIds: number[] = [];
let adminToken: string;
let operatorToken: string;

async function makeUser(roleName: string, tenant = tenantId) {
  const [user] = await db.insert(users).values({ tenantId: tenant, email: `system-health-${roleName}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), tenantId: tenant, roleId: null, roleName, department: null });
}

describe("System Health (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `System Health Test Tenant ${suffix}`, code: `sys-health-${suffix}` }).returning();
    tenantId = tenant!.id;
    const [other] = await db.insert(tenants).values({ name: `System Health Other Tenant ${suffix}`, code: `sys-health-other-${suffix}` }).returning();
    otherTenantId = other!.id;

    adminToken = await makeUser("admin");
    operatorToken = await makeUser("operator");
  });

  afterAll(async () => {
    await db.delete(inventoryAlerts).where(eq(inventoryAlerts.tenantId, tenantId));
    await db.delete(inventoryItems).where(eq(inventoryItems.tenantId, tenantId));
    await db.delete(inventoryAlerts).where(eq(inventoryAlerts.tenantId, otherTenantId));
    await db.delete(inventoryItems).where(eq(inventoryItems.tenantId, otherTenantId));
    await db.delete(notificationLog).where(eq(notificationLog.tenantId, tenantId));
    await db.delete(users).where(eq(users.tenantId, tenantId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await db.delete(tenants).where(eq(tenants.id, otherTenantId));
    await pool.end();
  });

  it("a non-admin is blocked outright", async () => {
    const res = await request(app).get("/system-health").set("Authorization", `Bearer ${operatorToken}`);
    expect(res.status).toBe(403);
  });

  it("admin gets a full report with all 8 sub-checks and an overall status", async () => {
    const res = await request(app).get("/system-health").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(["ok", "warning", "critical"]).toContain(res.body.overall);
    for (const key of ["database", "monitoring", "ai", "workflow", "email", "reporting", "receivingInventory", "supplierPortal"]) {
      expect(res.body.checks[key]).toBeTruthy();
      expect(["ok", "warning", "critical"]).toContain(res.body.checks[key].status);
    }
    // The monitoring card lists every alert rule and which outside connections are switched on.
    const m = res.body.checks.monitoring;
    expect(m.alerts.map((a: { key: string }) => a.key)).toEqual(["database", "api_errors", "workers", "workflow_failures", "login_attacks", "email_failures"]);
    expect(m.configured).toMatchObject({ errorTracking: expect.any(Boolean), alertWebhook: expect.any(Boolean), heartbeat: expect.any(Boolean), workersMonitored: expect.any(Array) });
  });

  it("receivingInventory reports ok with zero unacknowledged below-min alerts, and counts real ones when present", async () => {
    const zero = await request(app).get("/system-health").set("Authorization", `Bearer ${adminToken}`);
    expect(zero.body.checks.receivingInventory.status).toBe("ok");
    expect(zero.body.checks.receivingInventory.itemsBelowMin).toBe(0);

    const [item] = await db.insert(inventoryItems).values({ tenantId, sku: `SYS-HEALTH-${suffix}` }).returning();
    // 6 unacknowledged alerts crosses the ">5" warning threshold.
    for (let i = 0; i < 6; i++) {
      await db.insert(inventoryAlerts).values({ tenantId, itemId: item!.id, alertType: "below_min" });
    }

    const withAlerts = await request(app).get("/system-health").set("Authorization", `Bearer ${adminToken}`);
    expect(withAlerts.body.checks.receivingInventory.status).toBe("warning");
    expect(withAlerts.body.checks.receivingInventory.itemsBelowMin).toBe(6);
  });

  it("a below-min alert under a DIFFERENT tenant never counts toward this tenant's report", async () => {
    const [otherItem] = await db.insert(inventoryItems).values({ tenantId: otherTenantId, sku: `OTHER-TENANT-${suffix}` }).returning();
    await db.insert(inventoryAlerts).values({ tenantId: otherTenantId, itemId: otherItem!.id, alertType: "below_min" });

    // This tenant's own count (6, from the previous test) must be unchanged
    // by another tenant's alerts existing in the same table.
    const res = await request(app).get("/system-health").set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.checks.receivingInventory.itemsBelowMin).toBe(6);
  });

  it("email check reflects real notification_log rows for this tenant, not a hardcoded reading", async () => {
    await db.insert(notificationLog).values({ tenantId, recipient: "a@test.local", subject: "Test", body: "x", status: "logged_only" });
    await db.insert(notificationLog).values({ tenantId, recipient: "b@test.local", subject: "Test", body: "x", status: "logged_only" });

    const res = await request(app).get("/system-health").set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.checks.email.status).toBe("ok");
    expect(res.body.checks.email.loggedOnly).toBeGreaterThanOrEqual(2);
    expect(res.body.checks.email.sent).toBe(0);
    expect(res.body.checks.email.failed).toBe(0);
  });
});
