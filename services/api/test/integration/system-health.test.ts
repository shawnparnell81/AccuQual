import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Full-System Audit finding M8 (highest priority in that finding's list):
// system-health had zero test coverage — no RBAC check on the admin-only
// gate, and no coverage of any of its 7 sub-checks' real aggregation logic.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { inventoryItems, inventoryAlerts } from "../../src/drizzle/schema/inventory.js";
import { notificationLog } from "../../src/drizzle/schema/notifications.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();

let companyId: number;

const userIds: number[] = [];
let adminToken: string;
let operatorToken: string;

async function makeUser(roleName: string, co = companyId) {
  const [user] = await db.insert(users).values({ email: `system-health-${roleName}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName, department: null });
}

describe("System Health (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;
    
    

    adminToken = await makeUser("admin");
    operatorToken = await makeUser("operator");
  });

  afterAll(async () => {
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

    const [item] = await db.insert(inventoryItems).values({ sku: `SYS-HEALTH-${suffix}` }).returning();
    // 6 unacknowledged alerts crosses the ">5" warning threshold.
    for (let i = 0; i < 6; i++) {
      await db.insert(inventoryAlerts).values({ itemId: item!.id, alertType: "below_min" });
    }

    const withAlerts = await request(app).get("/system-health").set("Authorization", `Bearer ${adminToken}`);
    expect(withAlerts.body.checks.receivingInventory.status).toBe("warning");
    expect(withAlerts.body.checks.receivingInventory.itemsBelowMin).toBe(6);
  });

  ;

  it("email check reflects real notification_log rows for this company, not a hardcoded reading", async () => {
    await db.insert(notificationLog).values({ recipient: "a@test.local", subject: "Test", body: "x", status: "logged_only" });
    await db.insert(notificationLog).values({ recipient: "b@test.local", subject: "Test", body: "x", status: "logged_only" });

    const res = await request(app).get("/system-health").set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.checks.email.status).toBe("ok");
    expect(res.body.checks.email.loggedOnly).toBeGreaterThanOrEqual(2);
    expect(res.body.checks.email.sent).toBe(0);
    expect(res.body.checks.email.failed).toBe(0);
  });
});
