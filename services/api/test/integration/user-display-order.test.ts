import { ensureTestCompany } from "../helpers/company.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { asc, eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { company } from "../../src/drizzle/schema/company.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { INITIAL_LEAD_EMAIL } from "../../src/modules/users/userDisplayOrder.js";

const app = createApp();
const suffix = Date.now();

let ownerId: number;
let ownerToken: string;
let managerToken: string;
let leadId: number;
let earlyStaffId: number;
let earlyPresidentId: number;
let earlyDirectorId: number;

describe("user display order", () => {
  beforeAll(async () => {
    await ensureTestCompany();
    const roleId = async (name: string) => (await db.select({ id: roles.id }).from(roles).where(eq(roles.name, name)))[0]!.id;
    const ownerRole = await roleId("owner");
    const staffRole = await roleId("staff");
    const presidentRole = await roleId("president");
    const directorRole = await roleId("director");
    const managerRole = await roleId("quality_manager");

    const insert = async (email: string, name: string, role: number | null) => {
      const [row] = await db
        .insert(users)
        .values({ email, passwordHash: "x", name, roleId: role, mustChangePassword: false })
        .returning({ id: users.id });
      return row!.id;
    };

    ownerId = await insert(`order-owner-${suffix}@test.local`, "Order Owner", ownerRole);
    const managerId = await insert(`order-qm-${suffix}@test.local`, "Quality Manager", managerRole);
    earlyStaffId = await insert(`order-staff-${suffix}@test.local`, "Early Staff", staffRole);
    earlyPresidentId = await insert(`order-president-${suffix}@test.local`, "Early President", presidentRole);
    leadId = await insert(INITIAL_LEAD_EMAIL, "Shawn Parnell", ownerRole);
    earlyDirectorId = await insert(`order-director-${suffix}@test.local`, "Early Director", directorRole);

    ownerToken = signAccessToken({ sub: String(ownerId), roleId: ownerRole, roleName: "owner", department: null, tv: 0 });
    managerToken = signAccessToken({ sub: String(managerId), roleId: managerRole, roleName: "quality_manager", department: "quality", tv: 0 });
  });

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await pool.end();
  });

  function idsOf(body: { id: number }[]) {
    return body.map((row) => row.id);
  }

  it("places the rollout account first and keeps the other existing accounts in id order", async () => {
    const list = await request(app).get("/users").set("Authorization", `Bearer ${ownerToken}`);
    expect(list.status).toBe(200);
    const stored = await db.select({ id: users.id }).from(users).orderBy(asc(users.id));
    const expected = stored.map((row) => row.id);
    const leadAt = expected.indexOf(leadId);
    expected.splice(leadAt, 1);
    expected.unshift(leadId);
    expect(idsOf(list.body)).toEqual(expected);

    const audits = await db.select().from(auditTrail);
    const init = audits.filter((row) => (row.changes as { action?: string } | null)?.action === "user_display_order_initialized");
    expect(init).toHaveLength(1);
    expect(init[0]?.performedBy).toBe(ownerId);
    expect(init[0]?.createdAt).toBeInstanceOf(Date);
    expect((init[0]?.changes as { leadPlacedFirst?: boolean }).leadPlacedFirst).toBe(true);
    expect((init[0]?.changes as { system?: boolean }).system).toBe(true);

    const again = await request(app).get("/users").set("Authorization", `Bearer ${ownerToken}`);
    expect(idsOf(again.body)).toEqual(expected);
    const initAgain = (await db.select().from(auditTrail)).filter((row) => (row.changes as { action?: string } | null)?.action === "user_display_order_initialized");
    expect(initAgain).toHaveLength(1);
  });

  it("lists people who are not in the saved order after it, by role rank then name", async () => {
    const roleId = async (name: string) => (await db.select({ id: roles.id }).from(roles).where(eq(roles.name, name)))[0]!.id;
    const staffRole = await roleId("staff");
    const ownerRole = await roleId("owner");
    const insert = async (email: string, name: string, role: number | null) => {
      const [row] = await db.insert(users).values({ email, passwordHash: "x", name, roleId: role, mustChangePassword: false }).returning({ id: users.id });
      return row!.id;
    };
    const zedId = await insert(`order-zed-${suffix}@test.local`, "Zed Late", staffRole);
    const amyId = await insert(`order-amy-${suffix}@test.local`, "Amy Late", staffRole);
    const bossId = await insert(`order-boss-${suffix}@test.local`, "Zulu Late", ownerRole);
    const blankId = await insert(`order-blank-${suffix}@test.local`, "Aaron Blank", null);

    const before = idsOf((await request(app).get("/users").set("Authorization", `Bearer ${ownerToken}`)).body);
    const head = before.filter((id) => ![zedId, amyId, bossId, blankId].includes(id));
    expect(before.slice(0, head.length)).toEqual(head);
    expect(before.slice(head.length)).toEqual([bossId, amyId, zedId, blankId]);

    const asManager = await request(app).get("/users").set("Authorization", `Bearer ${managerToken}`);
    expect(asManager.status).toBe(200);
    expect(idsOf(asManager.body)).toEqual(before);
    expect(asManager.body[0].mfaEnabled).toBeUndefined();
  });

  it("saves an administrator's move and records who, what, and when", async () => {
    const current = idsOf((await request(app).get("/users").set("Authorization", `Bearer ${ownerToken}`)).body);
    const blankId = current[current.length - 1]!;
    const next = [current[0]!, blankId, ...current.slice(1, -1)];
    const saved = await request(app).put("/users/display-order").set("Authorization", `Bearer ${ownerToken}`).send({ userIds: next, movedUserId: blankId });
    expect(saved.status).toBe(200);
    expect(idsOf((await request(app).get("/users").set("Authorization", `Bearer ${ownerToken}`)).body)).toEqual(next);

    const audits = await db.select().from(auditTrail);
    const move = audits.find((row) => (row.changes as { action?: string } | null)?.action === "user_display_order");
    expect(move?.performedBy).toBe(ownerId);
    expect(move?.createdAt).toBeInstanceOf(Date);
    const changes = move?.changes as { movedUserId?: number; movedUserName?: string; fromIndex?: number; toIndex?: number };
    expect(changes.movedUserId).toBe(blankId);
    expect(changes.movedUserName).toBe("Aaron Blank");
    expect(changes.fromIndex).toBe(current.length);
    expect(changes.toIndex).toBe(2);

    const refused = await request(app).put("/users/display-order").set("Authorization", `Bearer ${managerToken}`).send({ userIds: current, movedUserId: blankId });
    expect(refused.status).toBe(403);
    expect(idsOf((await request(app).get("/users").set("Authorization", `Bearer ${ownerToken}`)).body)).toEqual(next);

    const partial = await request(app).put("/users/display-order").set("Authorization", `Bearer ${ownerToken}`).send({ userIds: next.slice(1), movedUserId: blankId });
    expect(partial.status).toBe(400);
  });

  it("refuses a deactivated person as a new manager and keeps one already on the account", async () => {
    const kept = await request(app).patch(`/users/${earlyDirectorId}`).set("Authorization", `Bearer ${ownerToken}`).send({ managerId: earlyStaffId });
    expect(kept.status).toBe(200);
    const turnedOff = await request(app).patch(`/users/${earlyStaffId}`).set("Authorization", `Bearer ${ownerToken}`).send({ isActive: false });
    expect(turnedOff.status).toBe(200);
    const sameManager = await request(app).patch(`/users/${earlyDirectorId}`).set("Authorization", `Bearer ${ownerToken}`).send({ managerId: earlyStaffId });
    expect(sameManager.status).toBe(200);
    expect(sameManager.body.managerId).toBe(earlyStaffId);
    const newly = await request(app).patch(`/users/${ownerId}`).set("Authorization", `Bearer ${ownerToken}`).send({ managerId: earlyStaffId });
    expect(newly.status).toBe(400);
    expect(newly.body.message).toBe("Choose an active person.");
    const listed = await request(app).get("/users").set("Authorization", `Bearer ${ownerToken}`);
    expect(listed.body.find((row: { id: number }) => row.id === earlyStaffId)?.isActive).toBe(false);
  });

  it("keeps the order when company settings are saved", async () => {
    const [before] = await db.select({ profile: company.profile }).from(company);
    const order = before?.profile?.userDisplayOrder;
    expect(order?.length).toBeGreaterThan(0);
    const patched = await request(app).patch("/company/profile").set("Authorization", `Bearer ${ownerToken}`).send({ timezone: "America/New_York" });
    expect(patched.status).toBe(200);
    const [after] = await db.select({ profile: company.profile }).from(company);
    expect(after?.profile?.userDisplayOrder).toEqual(order);
    expect(after?.profile?.timezone).toBe("America/New_York");
  });
});
