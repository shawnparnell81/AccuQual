import { ensureTestCompany } from "../helpers/company.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { company } from "../../src/drizzle/schema/company.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { systemRolesToInsert } from "../../src/modules/roles/deletedSystemRoles.js";
import { ROLE_SEEDS } from "../../src/modules/roles/roleHierarchy.js";

const app = createApp();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("soft-delete a built-in role", () => {
  let adminToken: string;
  let staffToken: string;
  let adminRoleId: number;

  beforeAll(async () => {
    await ensureTestCompany();
    const [adminRole] = await db.select().from(roles).where(eq(roles.name, "admin"));
    const [staffRole] = await db.select().from(roles).where(eq(roles.name, "staff"));
    adminRoleId = adminRole!.id;
    const [admin] = await db.insert(users).values({ email: "role-delete-admin@test.local", passwordHash: "unused", name: "Role Admin", roleId: adminRoleId }).returning();
    const [staff] = await db.insert(users).values({ email: "role-delete-staff@test.local", passwordHash: "unused", name: "Role Staff", roleId: staffRole!.id }).returning();
    adminToken = signAccessToken({ sub: String(admin!.id), roleId: adminRoleId, roleName: "admin", department: null });
    staffToken = signAccessToken({ sub: String(staff!.id), roleId: staffRole!.id, roleName: "staff", department: null });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("hides a built-in role, keeps the row, writes one audit entry, and does not seed it again", async () => {
    const denied = await request(app).delete(`/roles/${(await db.select().from(roles).where(eq(roles.name, "executive")))[0]!.id}`).set(auth(staffToken));
    expect(denied.status).toBe(403);

    const [executive] = await db.select().from(roles).where(eq(roles.name, "executive"));
    const removed = await request(app).delete(`/roles/${executive!.id}`).set(auth(adminToken)).send({ reason: "Not used here" });
    expect(removed.status).toBe(204);

    const [stillThere] = await db.select().from(roles).where(eq(roles.name, "executive"));
    expect(stillThere?.id).toBe(executive!.id);

    const listed = await request(app).get("/roles").set(auth(adminToken));
    expect(listed.body.map((role: { name: string }) => role.name)).not.toContain("executive");
    const deleted = await request(app).get("/roles/deleted").set(auth(adminToken));
    expect(deleted.status).toBe(200);
    expect(deleted.body.find((role: { name: string }) => role.name === "executive")?.reason).toBe("Not used here");

    const [entry] = await db.select().from(auditTrail).where(eq(auditTrail.entityType, "Role"));
    const changes = entry?.changes as { name?: string; softDeleted?: boolean; reason?: string };
    expect(entry?.action).toBe("delete");
    expect(entry?.performedBy).toBeTruthy();
    expect(entry?.createdAt).toBeTruthy();
    expect(changes).toMatchObject({ name: "executive", softDeleted: true, reason: "Not used here" });

    const [profile] = await db.select({ profile: company.profile }).from(company);
    const names = (profile?.profile?.deletedSystemRoles ?? []).map((row) => row.name);
    expect(names).toContain("executive");
    expect(systemRolesToInsert(ROLE_SEEDS, ["owner", "admin"], names).map((role) => role.name)).not.toContain("executive");

    const restored = await request(app).post(`/roles/${executive!.id}/restore`).set(auth(adminToken));
    expect(restored.status).toBe(200);
    const after = await request(app).get("/roles").set(auth(adminToken));
    expect(after.body.map((role: { name: string }) => role.name)).toContain("executive");
  });

  it("asks for a new role when people are assigned, and refuses the last role-management role and the caller's own access", async () => {
    const [operator] = await db.select().from(roles).where(eq(roles.name, "operator"));
    const [staffRole] = await db.select().from(roles).where(eq(roles.name, "staff"));
    await db.insert(users).values({ email: "operator-holder@test.local", passwordHash: "unused", name: "On the floor", roleId: operator!.id });

    const blocked = await request(app).delete(`/roles/${operator!.id}`).set(auth(adminToken));
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/1 person is assigned to Operator/);

    const moved = await request(app).delete(`/roles/${operator!.id}`).set(auth(adminToken)).send({ replacementRoleId: staffRole!.id, reason: "Combined with staff" });
    expect(moved.status).toBe(204);

    const [owner] = await db.select().from(roles).where(eq(roles.name, "owner"));
    await db.update(roles).set({ permissions: (owner!.permissions ?? []).filter((key) => key !== "roles.manage") }).where(eq(roles.id, owner!.id));
    const last = await request(app).delete(`/roles/${adminRoleId}`).set(auth(adminToken)).send({ replacementRoleId: staffRole!.id });
    expect(last.status).toBe(409);
    expect(last.body.message).toMatch(/last role|your own access/);
  });
});
