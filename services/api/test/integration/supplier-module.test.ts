// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Security-audit finding (low): the core Suppliers module (CRUD,
// approve/conditional/suspend/remove lifecycle) had no dedicated test file —
// the existing supplier-portal.test.ts and supplier-rma-request.test.ts
// cover the external Supplier Portal, not supplier.routes.ts's own internal
// CRUD and lifecycle-status endpoints that gate a supplier's qualification
// status. Covers the real edit-vs-read department split (quality: edit,
// purchasing/material_management/production: read-only), the lifecycle
// transitions, disqualification being terminal, and tenant isolation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { suppliers } from "../../src/drizzle/schema/supplier.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
let otherTenantId: number;
let supplierId: number;
const userIds: number[] = [];
let qualityToken: string;
let purchasingToken: string;
let otherTenantToken: string;

describe("Suppliers core module (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `Supplier Test Tenant ${suffix}`, code: `supplier-test-${suffix}` }).returning();
    tenantId = tenant!.id;
    const [other] = await db.insert(tenants).values({ name: `Supplier Other Tenant ${suffix}`, code: `supplier-other-${suffix}` }).returning();
    otherTenantId = other!.id;
    await seedDefaultPermissions(tenantId);
    await seedDefaultPermissions(otherTenantId);

    async function makeUser(tid: number, department: string | null) {
      const [user] = await db.insert(users).values({ tenantId: tid, email: `supplier-${department ?? "none"}-${tid}-${suffix}@test.local`, passwordHash: "unused" }).returning();
      userIds.push(user!.id);
      return signAccessToken({ sub: String(user!.id), tenantId: tid, roleId: null, roleName: "operator", department });
    }

    qualityToken = await makeUser(tenantId, "quality");
    purchasingToken = await makeUser(tenantId, "purchasing");
    otherTenantToken = await makeUser(otherTenantId, "quality");
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, tenantId));
    await db.delete(suppliers).where(eq(suppliers.tenantId, tenantId));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, tenantId));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, otherTenantId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await db.delete(tenants).where(eq(tenants.id, otherTenantId));
    await pool.end();
  });

  it("purchasing (read-only) cannot create a supplier", async () => {
    const res = await request(app).post("/suppliers").set("Authorization", `Bearer ${purchasingToken}`).send({ name: `Blocked Supplier ${suffix}` });
    expect(res.status).toBe(403);
  });

  it("quality (real edit access) creates a supplier, defaulting to active", async () => {
    const res = await request(app).post("/suppliers").set("Authorization", `Bearer ${qualityToken}`).send({ name: `Test Supplier ${suffix}` });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("active");
    supplierId = res.body.id;
  });

  it("purchasing (read-only) can still list and read suppliers", async () => {
    const list = await request(app).get("/suppliers").set("Authorization", `Bearer ${purchasingToken}`);
    expect(list.status).toBe(200);
    const detail = await request(app).get(`/suppliers/${supplierId}`).set("Authorization", `Bearer ${purchasingToken}`);
    expect(detail.status).toBe(200);
  });

  it("purchasing (read-only) cannot suspend a supplier", async () => {
    const res = await request(app).post(`/suppliers/${supplierId}/suspend`).set("Authorization", `Bearer ${purchasingToken}`);
    expect(res.status).toBe(403);
  });

  it("quality moves the supplier through conditional -> suspend, each a real logged status change", async () => {
    const conditional = await request(app).post(`/suppliers/${supplierId}/conditional`).set("Authorization", `Bearer ${qualityToken}`);
    expect(conditional.status).toBe(200);
    expect(conditional.body.status).toBe("probation");

    const suspend = await request(app).post(`/suppliers/${supplierId}/suspend`).set("Authorization", `Bearer ${qualityToken}`);
    expect(suspend.status).toBe(200);
    expect(suspend.body.status).toBe("suspended");

    const trail = await db.select().from(auditTrail).where(eq(auditTrail.entityId, supplierId));
    const actions = trail.filter((t) => t.entityType === "Supplier").map((t) => (t.changes as { action?: string })?.action);
    expect(actions).toEqual(expect.arrayContaining(["conditional", "suspend"]));
  });

  it("removes (disqualifies) the supplier — the one status change allowed to run even from suspended", async () => {
    const res = await request(app).post(`/suppliers/${supplierId}/remove`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("disqualified");
  });

  it("disqualification is terminal — cannot approve a disqualified supplier back to active", async () => {
    const res = await request(app).post(`/suppliers/${supplierId}/approve`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(400);
  });

  it("never returns another tenant's suppliers", async () => {
    const res = await request(app).get("/suppliers").set("Authorization", `Bearer ${otherTenantToken}`);
    expect(res.status).toBe(200);
    expect(res.body.some((s: { id: number }) => s.id === supplierId)).toBe(false);
  });
});
