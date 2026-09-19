// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Security-audit finding (low): quality-inspection-reports had no dedicated
// test file — its create/item/disposition CRUD flow and the "production has
// zero access" case are already covered incidentally inside
// scar-and-inspection-forms.test.ts, but two real gaps were still
// completely untested: the read-vs-edit split (purchasing/material_management
// get real read access, not just "quality edit or nothing") and tenant
// isolation. This file covers exactly those, without re-testing what that
// other file already does.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { qualityInspectionReports } from "../../src/drizzle/schema/qualityInspectionReports.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
let otherTenantId: number;
let reportId: number;
const userIds: number[] = [];
let qualityToken: string;
let purchasingToken: string;
let otherTenantToken: string;

describe("Quality Inspection Reports — RBAC read/edit split + tenant isolation (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `QIR RBAC Test Tenant ${suffix}`, code: `qir-rbac-test-${suffix}` }).returning();
    tenantId = tenant!.id;
    const [other] = await db.insert(tenants).values({ name: `QIR RBAC Other Tenant ${suffix}`, code: `qir-rbac-other-${suffix}` }).returning();
    otherTenantId = other!.id;
    await seedDefaultPermissions(tenantId);
    await seedDefaultPermissions(otherTenantId);

    const [qualityUser] = await db.insert(users).values({ tenantId, email: `qir-rbac-quality-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userIds.push(qualityUser!.id);
    qualityToken = signAccessToken({ sub: String(qualityUser!.id), tenantId, roleId: null, roleName: "operator", department: "quality" });

    const [purchasingUser] = await db.insert(users).values({ tenantId, email: `qir-rbac-purchasing-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userIds.push(purchasingUser!.id);
    purchasingToken = signAccessToken({ sub: String(purchasingUser!.id), tenantId, roleId: null, roleName: "operator", department: "purchasing" });

    const [otherUser] = await db.insert(users).values({ tenantId: otherTenantId, email: `qir-rbac-other-${suffix}@test.local`, passwordHash: "unused" }).returning();
    userIds.push(otherUser!.id);
    otherTenantToken = signAccessToken({ sub: String(otherUser!.id), tenantId: otherTenantId, roleId: null, roleName: "operator", department: "quality" });

    const [report] = await db.insert(qualityInspectionReports).values({ tenantId, inspectionType: "incoming" }).returning();
    reportId = report!.id;
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, tenantId));
    await db.delete(qualityInspectionReports).where(eq(qualityInspectionReports.tenantId, tenantId));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, tenantId));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, otherTenantId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await db.delete(tenants).where(eq(tenants.id, otherTenantId));
    await pool.end();
  });

  it("purchasing (real read access) can list and read a report", async () => {
    const list = await request(app).get("/quality-inspection-reports").set("Authorization", `Bearer ${purchasingToken}`);
    expect(list.status).toBe(200);
    const detail = await request(app).get(`/quality-inspection-reports/${reportId}`).set("Authorization", `Bearer ${purchasingToken}`);
    expect(detail.status).toBe(200);
  });

  it("purchasing (read-only, not edit) cannot update a report", async () => {
    const res = await request(app).patch(`/quality-inspection-reports/${reportId}`).set("Authorization", `Bearer ${purchasingToken}`).send({ finalStatus: "accepted" });
    expect(res.status).toBe(403);
  });

  it("quality (real edit access) can update a report", async () => {
    const res = await request(app).patch(`/quality-inspection-reports/${reportId}`).set("Authorization", `Bearer ${qualityToken}`).send({ finalStatus: "accepted" });
    expect(res.status).toBe(200);
    expect(res.body.finalStatus).toBe("accepted");
  });

  it("never returns another tenant's reports", async () => {
    const res = await request(app).get("/quality-inspection-reports").set("Authorization", `Bearer ${otherTenantToken}`);
    expect(res.status).toBe(200);
    expect(res.body.some((r: { id: number }) => r.id === reportId)).toBe(false);
  });

  it("a report from another tenant 404s instead of leaking by id", async () => {
    const res = await request(app).get(`/quality-inspection-reports/${reportId}`).set("Authorization", `Bearer ${otherTenantToken}`);
    expect(res.status).toBe(404);
  });
});
