// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Security-audit finding (low): rma-activity-log had no dedicated test
// file — a regression in this automated supplier-RMA event trail would
// ship silently. Covers the real RBAC split (quality: edit, customer_service:
// read, everyone else: none), the ?rmaId= narrowing filter, and tenant
// isolation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { suppliers } from "../../src/drizzle/schema/supplier.js";
import { rma } from "../../src/drizzle/schema/rma.js";
import { rmaActivityLog } from "../../src/drizzle/schema/supplierRma.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
let otherTenantId: number;
let rmaId: number;
const userIds: number[] = [];
let qualityToken: string;
let customerServiceToken: string;
let engineeringToken: string;

describe("RMA Activity Log (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `RMA Activity Log Test Tenant ${suffix}`, code: `rma-activity-test-${suffix}` }).returning();
    tenantId = tenant!.id;
    const [other] = await db.insert(tenants).values({ name: `RMA Activity Log Other Tenant ${suffix}`, code: `rma-activity-other-${suffix}` }).returning();
    otherTenantId = other!.id;
    await seedDefaultPermissions(tenantId);

    const [qualityUser] = await db.insert(users).values({ tenantId, email: `rma-activity-quality-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userIds.push(qualityUser!.id);
    qualityToken = signAccessToken({ sub: String(qualityUser!.id), tenantId, roleId: null, roleName: "operator", department: "quality" });

    const [csUser] = await db.insert(users).values({ tenantId, email: `rma-activity-cs-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userIds.push(csUser!.id);
    customerServiceToken = signAccessToken({ sub: String(csUser!.id), tenantId, roleId: null, roleName: "operator", department: "customer_service" });

    const [engUser] = await db.insert(users).values({ tenantId, email: `rma-activity-eng-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userIds.push(engUser!.id);
    engineeringToken = signAccessToken({ sub: String(engUser!.id), tenantId, roleId: null, roleName: "operator", department: "engineering" });

    const [supplier] = await db.insert(suppliers).values({ tenantId, name: `Test Supplier ${suffix}` }).returning();
    const [rmaRow] = await db.insert(rma).values({ tenantId, rmaNumber: `RMA-ACT-${suffix}`, supplierId: supplier!.id }).returning();
    rmaId = rmaRow!.id;

    await db.insert(rmaActivityLog).values({ tenantId, rmaId, event: "created", details: { note: "seed" } });
    await db.insert(rmaActivityLog).values({ tenantId, event: "unrelated_event" }); // no rmaId — must not appear in a ?rmaId= filtered view

    // Isolation fixture — same shape of data in a different tenant.
    const [otherSupplier] = await db.insert(suppliers).values({ tenantId: otherTenantId, name: `Other Supplier ${suffix}` }).returning();
    const [otherRma] = await db.insert(rma).values({ tenantId: otherTenantId, rmaNumber: `RMA-ACT-OTHER-${suffix}`, supplierId: otherSupplier!.id }).returning();
    await db.insert(rmaActivityLog).values({ tenantId: otherTenantId, rmaId: otherRma!.id, event: "created" });
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(rmaActivityLog).where(eq(rmaActivityLog.tenantId, tenantId));
    await db.delete(rmaActivityLog).where(eq(rmaActivityLog.tenantId, otherTenantId));
    await db.delete(rma).where(eq(rma.tenantId, tenantId));
    await db.delete(rma).where(eq(rma.tenantId, otherTenantId));
    await db.delete(suppliers).where(eq(suppliers.tenantId, tenantId));
    await db.delete(suppliers).where(eq(suppliers.tenantId, otherTenantId));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, tenantId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await db.delete(tenants).where(eq(tenants.id, otherTenantId));
    await pool.end();
  });

  it("quality (edit access) can list the tenant's activity log", async () => {
    const res = await request(app).get("/rma-activity-log").set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  it("customer_service (read access) can also list it", async () => {
    const res = await request(app).get("/rma-activity-log").set("Authorization", `Bearer ${customerServiceToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  it("engineering (zero access) is blocked", async () => {
    const res = await request(app).get("/rma-activity-log").set("Authorization", `Bearer ${engineeringToken}`);
    expect(res.status).toBe(403);
  });

  it("?rmaId= narrows to just that RMA's own timeline", async () => {
    const res = await request(app).get(`/rma-activity-log?rmaId=${rmaId}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].event).toBe("created");
  });

  it("never returns another tenant's activity log entries", async () => {
    const res = await request(app).get("/rma-activity-log").set("Authorization", `Bearer ${qualityToken}`);
    expect(res.body.every((r: { tenantId: number }) => r.tenantId === tenantId)).toBe(true);
  });
});
