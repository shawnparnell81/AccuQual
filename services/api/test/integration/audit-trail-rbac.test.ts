// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Regression coverage for Full-System Audit finding H1: GET
// /audit-trail/:entityType/:entityId had NO RBAC gate at all — any
// authenticated tenant user could read any other department's full
// change/decision history just by knowing or guessing an entityId. Tenant
// scoping itself was already correct; this was an intra-tenant
// information-disclosure gap.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
let ncrId: number;
const userIds: number[] = [];
let qualityToken: string;
let engineeringToken: string;
let adminToken: string;

async function makeUser(department: string | null, roleName = "operator") {
  const [user] = await db.insert(users).values({ tenantId, email: `audit-rbac-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName, department });
}

describe("Audit trail read RBAC — GET /audit-trail/:entityType/:entityId (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `Audit RBAC Test Tenant ${suffix}`, code: `audit-rbac-${suffix}` }).returning();
    tenantId = tenant!.id;
    await seedDefaultPermissions(tenantId);

    qualityToken = await makeUser("quality");
    // ncr's own default permission entry is quality-only ({ quality: "edit" }) —
    // engineering has zero rows for it, the real "no access whatsoever" case.
    engineeringToken = await makeUser("engineering");
    adminToken = await makeUser(null, "admin");

    const [created] = await db.insert(ncr).values({ tenantId, title: `Audit RBAC test NCR ${suffix}` }).returning();
    ncrId = created!.id;
    await db.insert(auditTrail).values({ tenantId, entityType: "NCR", entityId: ncrId, action: "create", changes: { title: created!.title } });
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, tenantId));
    await db.delete(ncr).where(eq(ncr.id, ncrId));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, tenantId));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it("quality (owns the ncr ResourceKey) can read this NCR's audit history", async () => {
    const res = await request(app).get(`/audit-trail/NCR/${ncrId}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("engineering (zero access to ncr) CANNOT read this NCR's audit history — previously anyone could", async () => {
    const res = await request(app).get(`/audit-trail/NCR/${ncrId}`).set("Authorization", `Bearer ${engineeringToken}`);
    expect(res.status).toBe(403);
  });

  it("admin bypasses the gate, same as every other module", async () => {
    const res = await request(app).get(`/audit-trail/NCR/${ncrId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it("a genuinely admin-only entity type (Tenant) blocks a non-admin outright", async () => {
    const res = await request(app).get(`/audit-trail/Tenant/${tenantId}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(403);
  });

  it("an entity type with no owning department gate today (e.g. DigitalTwinSimulation) stays open, matching that module's own real access level", async () => {
    const res = await request(app).get(`/audit-trail/DigitalTwinSimulation/999999`).set("Authorization", `Bearer ${engineeringToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
