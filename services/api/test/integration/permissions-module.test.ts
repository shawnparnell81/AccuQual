// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Covers the new self-service Roles & Permissions module: the department
// access grid (list/upsert/delete, live enforcement, no-hardcoded-fallback
// behavior — see departmentAccess.ts's own comment on why the old
// PERMISSION_MATRIX is gone entirely, not just demoted to a fallback),
// custom permission roles (create/module-grants/assign-to-user/delete-
// cascades), tenant isolation of the new tables, admin-only gating on
// every mutation route, and audit trail coverage.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { aiEmbeddings } from "../../src/drizzle/schema/ai.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { formData } from "../../src/drizzle/schema/forms.js";
import { departmentPermissions, permissionRoles } from "../../src/drizzle/schema/permissions.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
let otherTenantId: number;
let unseededTenantId: number;
let adminToken: string;
let qualityToken: string;
let productionUserId: number;
let productionToken: string;
let otherTenantAdminToken: string;
let unseededAdminToken: string;
let roleId: number;

async function makeUser(tenant: number, department: string | null, roleName = "operator") {
  const [user] = await db
    .insert(users)
    .values({ tenantId: tenant, email: `rbacmod-test-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused", department })
    .returning();
  const token = signAccessToken({ sub: String(user!.id), tenantId: tenant, roleId: null, roleName, department });
  return { id: user!.id, token };
}

describe("Roles & Permissions module (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `Permissions Test Tenant ${suffix}`, code: `rbacmod-test-${suffix}` }).returning();
    tenantId = tenant!.id;
    await seedDefaultPermissions(tenantId);
    const [otherTenant] = await db.insert(tenants).values({ name: `Permissions Test Tenant B ${suffix}`, code: `rbacmod-test-b-${suffix}` }).returning();
    otherTenantId = otherTenant!.id;
    await seedDefaultPermissions(otherTenantId);
    // Deliberately NEVER seeded — this is the one tenant in this file
    // standing in for "what a tenant looks like if it bypassed both real
    // seeding paths" (see seedDefaults.ts's own comment), to prove
    // getUserAccessLevel's genuine "no row = none" behavior rather than
    // assuming it from the seeded tenants' own passing tests.
    const [unseededTenant] = await db.insert(tenants).values({ name: `Permissions Unseeded Tenant ${suffix}`, code: `rbacmod-test-unseeded-${suffix}` }).returning();
    unseededTenantId = unseededTenant!.id;

    adminToken = (await makeUser(tenantId, null, "admin")).token;
    qualityToken = (await makeUser(tenantId, "quality")).token;
    const production = await makeUser(tenantId, "production");
    productionUserId = production.id;
    productionToken = production.token;
    otherTenantAdminToken = (await makeUser(otherTenantId, null, "admin")).token;
    unseededAdminToken = (await makeUser(unseededTenantId, null, "admin")).token;
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, tenantId));
    // Creating an NCR triggers a real ai_embeddings row (semantic search
    // indexing) — same cleanup every test that creates one already needs,
    // see tenant-isolation.test.ts's own comment.
    await db.delete(aiEmbeddings).where(eq(aiEmbeddings.tenantId, tenantId));
    await db.delete(formData).where(eq(formData.tenantId, tenantId));
    await db.delete(ncr).where(eq(ncr.tenantId, tenantId));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, tenantId));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, otherTenantId));
    await db.delete(permissionRoles).where(eq(permissionRoles.tenantId, tenantId)); // cascades role_modules + user_roles
    await db.delete(users).where(eq(users.tenantId, tenantId));
    await db.delete(users).where(eq(users.tenantId, otherTenantId));
    await db.delete(users).where(eq(users.tenantId, unseededTenantId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await db.delete(tenants).where(eq(tenants.id, otherTenantId));
    await db.delete(tenants).where(eq(tenants.id, unseededTenantId));
    await pool.end();
  });

  describe("admin-only gating", () => {
    it("non-admin cannot read the department-permissions grid", async () => {
      const res = await request(app).get("/permissions/department-permissions").set("Authorization", `Bearer ${qualityToken}`);
      expect(res.status).toBe(403);
    });

    it("non-admin cannot create a role", async () => {
      const res = await request(app).post("/permissions/roles").set("Authorization", `Bearer ${qualityToken}`).send({ roleName: "Should Fail" });
      expect(res.status).toBe(403);
    });

    it("any authenticated user CAN read the module catalog and their own effective permissions", async () => {
      const modules = await request(app).get("/permissions/modules").set("Authorization", `Bearer ${qualityToken}`);
      expect(modules.status).toBe(200);
      expect(modules.body.some((m: { key: string }) => m.key === "ncr")).toBe(true);

      const effective = await request(app).get("/permissions/effective").set("Authorization", `Bearer ${qualityToken}`);
      expect(effective.status).toBe(200);
      expect(effective.body.ncr).toBe("edit");
    });
  });

  describe("no hardcoded fallback — access is real database rows, full stop", () => {
    it("GET /permissions/effective for the seeded tenant's production user matches the real seeded rows", async () => {
      const res = await request(app).get("/permissions/effective").set("Authorization", `Bearer ${productionToken}`);
      expect(res.status).toBe(200);
      expect(res.body.work_orders).toBe("read"); // seeded default for production
      expect(res.body.ncr).toBe("none"); // production was never granted ncr at all
    });

    it("admin sees the full department x module grid with the seeded cells as real, explicit rows (isOverride:true)", async () => {
      const res = await request(app).get("/permissions/department-permissions").set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const cell = res.body.find((r: { departmentName: string; moduleName: string }) => r.departmentName === "production" && r.moduleName === "work_orders");
      expect(cell.accessLevel).toBe("read");
      expect(cell.isOverride).toBe(true); // a real seeded row — no more implicit fallback to be "not an override"
      expect(cell.id).not.toBeNull();
    });

    it("a tenant that was never seeded at all (bypassing both real seeding paths) genuinely gets \"none\" everywhere — no hidden fallback left to catch it", async () => {
      const grid = await request(app).get("/permissions/department-permissions").set("Authorization", `Bearer ${unseededAdminToken}`);
      expect(grid.status).toBe(200);
      expect(grid.body.every((r: { accessLevel: string; isOverride: boolean }) => r.accessLevel === "none" && r.isOverride === false)).toBe(true);

      const unseededQuality = await makeUser(unseededTenantId, "quality");
      const effective = await request(app).get("/permissions/effective").set("Authorization", `Bearer ${unseededQuality.token}`);
      // Quality gets "edit" on ncr in every OTHER test tenant because
      // seedDefaultPermissions() ran for it — here, deliberately, it never
      // did, so even quality/ncr — the single most universally-granted
      // permission in this whole app — is genuinely "none".
      expect(effective.body.ncr).toBe("none");
    });
  });

  describe("department access overrides take effect immediately, no redeploy, no re-login", () => {
    it("production cannot create an NCR before any override exists", async () => {
      const res = await request(app).post("/ncr").set("Authorization", `Bearer ${productionToken}`).send({ title: "Should be blocked", severity: "low" });
      expect(res.status).toBe(403);
    });

    it("admin grants production 'edit' on ncr via the self-service API", async () => {
      const res = await request(app)
        .patch("/permissions/department-permissions")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ departmentName: "production", moduleName: "ncr", accessLevel: "edit" });
      expect(res.status).toBe(200);
      expect(res.body.accessLevel).toBe("edit");
    });

    it("the SAME already-issued production token can now create an NCR — no new login/token needed", async () => {
      const res = await request(app).post("/ncr").set("Authorization", `Bearer ${productionToken}`).send({ title: "Now allowed", severity: "low" });
      expect(res.status).toBe(201);
    });

    it("the grid now reports this cell as an explicit override", async () => {
      const res = await request(app).get("/permissions/department-permissions").set("Authorization", `Bearer ${adminToken}`);
      const cell = res.body.find((r: { departmentName: string; moduleName: string }) => r.departmentName === "production" && r.moduleName === "ncr");
      expect(cell.accessLevel).toBe("edit");
      expect(cell.isOverride).toBe(true);
      expect(cell.id).not.toBeNull();
    });

    it("the grant was recorded in the audit trail", async () => {
      const rows = await db.select().from(auditTrail).where(eq(auditTrail.tenantId, tenantId));
      const row = rows.find((r) => r.entityType === "DepartmentPermission" && r.action === "create");
      expect(row).toBeTruthy();
      expect((row!.changes as Record<string, unknown>).newValue).toBe("edit");
    });

    it("DELETE reverts the override back to the shipped default", async () => {
      const del = await request(app).delete("/permissions/department-permissions").set("Authorization", `Bearer ${adminToken}`).send({ departmentName: "production", moduleName: "ncr" });
      expect(del.status).toBe(204);

      const after = await request(app).post("/ncr").set("Authorization", `Bearer ${productionToken}`).send({ title: "Should be blocked again", severity: "low" });
      expect(after.status).toBe(403);
    });

    it("deleting a non-existent override 404s", async () => {
      const res = await request(app).delete("/permissions/department-permissions").set("Authorization", `Bearer ${adminToken}`).send({ departmentName: "production", moduleName: "ncr" });
      expect(res.status).toBe(404);
    });
  });

  describe("tenant isolation", () => {
    it("tenant A's override never leaks into tenant B's grid", async () => {
      await request(app).patch("/permissions/department-permissions").set("Authorization", `Bearer ${adminToken}`).send({ departmentName: "production", moduleName: "ncr", accessLevel: "edit" });

      const otherGrid = await request(app).get("/permissions/department-permissions").set("Authorization", `Bearer ${otherTenantAdminToken}`);
      const cell = otherGrid.body.find((r: { departmentName: string; moduleName: string }) => r.departmentName === "production" && r.moduleName === "ncr");
      expect(cell.accessLevel).toBe("none"); // tenant B's own default — untouched by tenant A's override
      expect(cell.isOverride).toBe(false);

      // clean up tenant A's override for the tests below
      await request(app).delete("/permissions/department-permissions").set("Authorization", `Bearer ${adminToken}`).send({ departmentName: "production", moduleName: "ncr" });
    });
  });

  describe("custom permission roles — additive on top of the department baseline", () => {
    it("admin creates a custom role", async () => {
      const res = await request(app).post("/permissions/roles").set("Authorization", `Bearer ${adminToken}`).send({ roleName: "Line Lead", description: "Extra RMA Log visibility" });
      expect(res.status).toBe(201);
      expect(res.body.modules).toEqual([]);
      expect(res.body.memberCount).toBe(0);
      roleId = res.body.id;
    });

    it("production has no rma_log access before any role grant", async () => {
      const res = await request(app).get("/permissions/effective").set("Authorization", `Bearer ${productionToken}`);
      expect(res.body.rma_log).toBe("none");
    });

    it("admin grants the role 'edit' on rma_log", async () => {
      const res = await request(app).patch(`/permissions/roles/${roleId}/modules`).set("Authorization", `Bearer ${adminToken}`).send({ moduleName: "rma_log", accessLevel: "edit" });
      expect(res.status).toBe(200);
      expect(res.body.accessLevel).toBe("edit");
    });

    it("assigning the role to the production user grants rma_log access immediately", async () => {
      const assign = await request(app).post("/permissions/user-roles").set("Authorization", `Bearer ${adminToken}`).send({ userId: productionUserId, roleId });
      expect(assign.status).toBe(201);

      const effective = await request(app).get("/permissions/effective").set("Authorization", `Bearer ${productionToken}`);
      expect(effective.body.rma_log).toBe("edit");
    });

    it("the role now shows one member, and GET /permissions/user-roles lists the assignment", async () => {
      const roles = await request(app).get("/permissions/roles").set("Authorization", `Bearer ${adminToken}`);
      const role = roles.body.find((r: { id: number }) => r.id === roleId);
      expect(role.memberCount).toBe(1);
      expect(role.modules).toEqual([{ moduleName: "rma_log", accessLevel: "edit" }]);

      const assignments = await request(app).get("/permissions/user-roles").set("Authorization", `Bearer ${adminToken}`);
      expect(assignments.body.some((a: { userId: number; roleId: number }) => a.userId === productionUserId && a.roleId === roleId)).toBe(true);
    });

    it("GET /permissions/users/:userId/effective breaks down the department baseline vs. the role-granted total", async () => {
      const res = await request(app).get(`/permissions/users/${productionUserId}/effective`).set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const rmaLog = res.body.breakdown.find((b: { moduleName: string }) => b.moduleName === "rma_log");
      expect(rmaLog.departmentLevel).toBe("none"); // production gets nothing from its own department on this module
      expect(rmaLog.effectiveLevel).toBe("edit"); // ...but the custom role grant lifts it
    });

    it("deleting the role cascades — removes the module grant and the user assignment, access reverts", async () => {
      const del = await request(app).delete(`/permissions/roles/${roleId}`).set("Authorization", `Bearer ${adminToken}`);
      expect(del.status).toBe(204);

      const effective = await request(app).get("/permissions/effective").set("Authorization", `Bearer ${productionToken}`);
      expect(effective.body.rma_log).toBe("none");

      const assignments = await request(app).get("/permissions/user-roles").set("Authorization", `Bearer ${adminToken}`);
      expect(assignments.body.some((a: { roleId: number }) => a.roleId === roleId)).toBe(false);
    });
  });
});
