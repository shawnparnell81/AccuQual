import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Covers the new self-service Roles & Permissions module: the department
// access grid (list/upsert/delete, live enforcement, no-hardcoded-fallback
// behavior — see departmentAccess.ts's own comment on why the old
// PERMISSION_MATRIX is gone entirely, not just demoted to a fallback),
// custom permission roles (create/module-grants/assign-to-user/delete-
// cascades), company isolation of the new tables, admin-only gating on
// every mutation route, and audit trail coverage.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
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

let companyId: number;


let adminToken: string;
let qualityToken: string;
let productionUserId: number;
let productionToken: string;


let roleId: number;

async function makeUser(co: number, department: string | null, roleName = "operator") {
  const [user] = await db
    .insert(users)
    .values({ email: `rbacmod-test-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused", department })
    .returning();
  const token = signAccessToken({ sub: String(user!.id), roleId: null, roleName, department });
  return { id: user!.id, token };
}

describe("Roles & Permissions module (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;
    await seedDefaultPermissions(companyId);
    
    
    
    // Deliberately NEVER seeded — this is the one company in this file
    // standing in for "what a company looks like if it bypassed both real
    // seeding paths" (see seedDefaults.ts's own comment), to prove
    // getUserAccessLevel's genuine "no row = none" behavior rather than
    // assuming it from the seeded companies' own passing tests.
    
    

    adminToken = (await makeUser(companyId, null, "admin")).token;
    qualityToken = (await makeUser(companyId, "quality")).token;
    const production = await makeUser(companyId, "production");
    productionUserId = production.id;
    productionToken = production.token;
    
    
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    // Creating an NCR triggers a real ai_embeddings row (semantic search
    // indexing) — same cleanup every test that creates one already needs,
    // see company-isolation.test.ts's own comment.
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
    it("GET /permissions/effective for the seeded company's production user matches the real seeded rows", async () => {
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

    ;
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
      const rows = await db.select().from(auditTrail);
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
