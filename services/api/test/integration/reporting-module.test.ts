// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Security-audit finding (low): reporting.routes.ts has 8 endpoints
// (metrics, export, summary, schedules CRUD, send-now) with zero test
// coverage — no coverage of report-schedule tenant isolation or the
// admin-only gate on schedule CRUD (see that file's own comment on why
// schedules are admin-only, distinct from the per-report ResourceKey gates
// the metrics endpoints use).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { reportSchedules } from "../../src/drizzle/schema/reporting.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();
let tenantId: number;
let otherTenantId: number;
const userIds: number[] = [];
let adminToken: string;
let operatorToken: string;
let otherAdminToken: string;

describe("Reporting schedules (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `Reporting Test Tenant ${suffix}`, code: `report-test-${suffix}` }).returning();
    tenantId = tenant!.id;
    const [other] = await db.insert(tenants).values({ name: `Reporting Other Tenant ${suffix}`, code: `report-other-${suffix}` }).returning();
    otherTenantId = other!.id;

    const [admin] = await db.insert(users).values({ tenantId, email: `report-admin-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userIds.push(admin!.id);
    adminToken = signAccessToken({ sub: String(admin!.id), tenantId, roleId: null, roleName: "admin", department: null });

    const [operator] = await db.insert(users).values({ tenantId, email: `report-operator-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userIds.push(operator!.id);
    operatorToken = signAccessToken({ sub: String(operator!.id), tenantId, roleId: null, roleName: "operator", department: "quality" });

    const [otherAdmin] = await db.insert(users).values({ tenantId: otherTenantId, email: `report-other-admin-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userIds.push(otherAdmin!.id);
    otherAdminToken = signAccessToken({ sub: String(otherAdmin!.id), tenantId: otherTenantId, roleId: null, roleName: "admin", department: null });
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, tenantId));
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, otherTenantId));
    await db.delete(reportSchedules).where(eq(reportSchedules.tenantId, tenantId));
    await db.delete(reportSchedules).where(eq(reportSchedules.tenantId, otherTenantId));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await db.delete(tenants).where(eq(tenants.id, otherTenantId));
    await pool.end();
  });

  it("a non-admin (operator) cannot create a schedule — admin-only, distinct from the per-report ResourceKey gates", async () => {
    const res = await request(app)
      .post("/reporting/schedules")
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ reportType: "ncr_summary", frequency: "weekly", recipients: ["qm@test.local"] });
    expect(res.status).toBe(403);
  });

  it("admin creates a schedule and it's scoped to the creating tenant", async () => {
    const res = await request(app)
      .post("/reporting/schedules")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reportType: "ncr_summary", frequency: "weekly", recipients: ["qm@test.local"] });
    expect(res.status).toBe(201);
    expect(res.body.tenantId).toBe(tenantId);
  });

  it("tenant B cannot see tenant A's schedules", async () => {
    await request(app)
      .post("/reporting/schedules")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reportType: "capa_summary", frequency: "monthly", recipients: ["qm@test.local"] });
    const res = await request(app).get("/reporting/schedules").set("Authorization", `Bearer ${otherAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.every((s: { tenantId: number }) => s.tenantId === otherTenantId)).toBe(true);
  });

  it("rejects an invalid reportType instead of crashing", async () => {
    const res = await request(app)
      .post("/reporting/schedules")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reportType: "not_a_real_type", frequency: "weekly", recipients: ["qm@test.local"] });
    expect(res.status).toBe(400);
  });
});
