import { ensureTestCompany } from "../helpers/company.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { desc, eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("bulk permission changes", () => {
  let adminId: number;
  let adminToken: string;
  let staffId: number;

  beforeAll(async () => {
    await ensureTestCompany();
    const [admin] = await db.insert(users).values({ email: "perm-bulk-admin@test.local", passwordHash: "unused", name: "Permission Admin" }).returning();
    adminId = admin!.id;
    adminToken = signAccessToken({ sub: String(adminId), roleId: null, roleName: "admin", department: null });
    const [staff] = await db.select().from(roles).where(eq(roles.name, "staff"));
    staffId = staff!.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("writes one audit entry listing every permission a role gained or lost", async () => {
    const saved = await request(app)
      .patch(`/roles/${staffId}`)
      .set(auth(adminToken))
      .send({ permissions: ["login_history", "sites.view_all", "executive.dashboard"] });
    expect(saved.status).toBe(200);
    expect(saved.body.permissions).toEqual(["login_history", "sites.view_all", "executive.dashboard"]);

    const [entry] = await db.select().from(auditTrail).where(eq(auditTrail.entityType, "Role")).orderBy(desc(auditTrail.id));
    const changes = entry?.changes as { bulk?: boolean; roleName?: string; permissions?: { granted: string[]; revoked: string[] } };
    expect(entry?.entityId).toBe(staffId);
    expect(entry?.action).toBe("update");
    expect(entry?.performedBy).toBe(adminId);
    expect(entry?.createdAt).toBeTruthy();
    expect(changes.bulk).toBe(true);
    expect(changes.roleName).toBe("staff");
    expect(changes.permissions).toEqual({ granted: ["login_history", "sites.view_all", "executive.dashboard"], revoked: [] });
    expect(saved.body.permissions).not.toContain("superuser");
  });

  it("writes one audit entry for a department column of access changes", async () => {
    const saved = await request(app)
      .patch("/permissions/department-permissions/bulk")
      .set(auth(adminToken))
      .send({
        cells: [
          { departmentName: "quality", moduleName: "ncr", accessLevel: "edit" },
          { departmentName: "quality", moduleName: "capa", accessLevel: "read" },
          { departmentName: "quality", moduleName: "ncr", accessLevel: "none" },
        ],
      });
    expect(saved.status).toBe(400);

    const once = await request(app)
      .patch("/permissions/department-permissions/bulk")
      .set(auth(adminToken))
      .send({
        cells: [
          { departmentName: "quality", moduleName: "ncr", accessLevel: "edit" },
          { departmentName: "quality", moduleName: "capa", accessLevel: "read" },
        ],
      });
    expect(once.status).toBe(200);
    expect(once.body.updated).toBe(2);

    const entries = await db.select().from(auditTrail).where(eq(auditTrail.entityType, "DepartmentPermission"));
    expect(entries).toHaveLength(1);
    const changes = entries[0]?.changes as { bulk?: boolean; cells?: { departmentName: string; moduleName: string; to: string }[] };
    expect(entries[0]?.performedBy).toBe(adminId);
    expect(entries[0]?.createdAt).toBeTruthy();
    expect(changes.bulk).toBe(true);
    expect(changes.cells).toEqual([
      { departmentName: "quality", moduleName: "ncr", from: "none", to: "edit" },
      { departmentName: "quality", moduleName: "capa", from: "none", to: "read" },
    ]);
  });
});
