import { ensureTestCompany } from "../helpers/company.js";
// A signed-in person can change their own password. Other sessions end, every
// trusted device is forgotten, and this browser stays signed in for the time
// already left on its 12-hour sign-in. An account an administrator created, or
// one given a temporary password, cannot use the rest of the app until they
// choose their own.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import { and, eq, isNull } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { refreshTokens } from "../../src/drizzle/schema/refreshTokens.js";
import { trustedDevices } from "../../src/drizzle/schema/trustedDevices.js";
import { passwordResetTokens } from "../../src/drizzle/schema/passwordResetTokens.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { totpAt, totpCounter } from "../../src/utils/totp.js";
import { setEmailTransport } from "../../src/modules/notifications/notification.service.js";

const app = createApp();
const suffix = Date.now();
const CURRENT = "violet-lantern-quarry-88";
const NEXT = "granite-meadow-lamp-42";
const WEAK = "letmein123456";
const CSRF = { "X-AccuQual-Csrf": "1" };

let adminRoleId: number;
const sentMail: { to: string; subject: string; body: string }[] = [];

async function ensureRole(name: string): Promise<number> {
  const [existing] = await db.select().from(roles).where(eq(roles.name, name));
  if (existing) return existing.id;
  const [created] = await db.insert(roles).values({ name }).onConflictDoNothing().returning();
  if (created) return created.id;
  return (await db.select().from(roles).where(eq(roles.name, name)))[0]!.id;
}

async function makeUser(label: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const email = `pwchange-${label}-${suffix}@test.local`;
  const [user] = await db.insert(users).values({ email, passwordHash: await bcrypt.hash(CURRENT, 4), ...extra }).returning();
  return { id: user!.id, email };
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const codeAt = (secret: string, stepOffset = 0) => totpAt(secret, totpCounter() + stepOffset);

async function actionsFor(userId: number) {
  const rows = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "User"), eq(auditTrail.entityId, userId)));
  return rows.map((row) => row.changes as { action?: string; reason?: string } | null);
}

describe("password change (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    await ensureTestCompany();
    adminRoleId = await ensureRole("admin");
    setEmailTransport({
      send: async (message) => {
        sentMail.push(message);
        return "sent";
      },
    });
  });

  afterAll(async () => {
    setEmailTransport(null);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await pool.end();
  });

  it("refuses a wrong current password and leaves the account unchanged", async () => {
    const user = await makeUser("wrong");
    const session = await request(app).post("/auth/login").send({ email: user.email, password: CURRENT });
    expect(session.status).toBe(200);
    const token = session.body.accessToken as string;

    const changed = await request(app).post("/auth/change-password").set(bearer(token)).send({ currentPassword: "wrong-password-value", newPassword: NEXT });
    expect(changed.status).toBe(401);

    expect((await request(app).post("/auth/login").send({ email: user.email, password: CURRENT })).status).toBe(200);
    expect((await request(app).get("/auth/me").set(bearer(token))).status).toBe(200);
  });

  it("refuses a password the existing rules reject", async () => {
    const user = await makeUser("weak");
    const token = (await request(app).post("/auth/login").send({ email: user.email, password: CURRENT })).body.accessToken as string;
    const changed = await request(app).post("/auth/change-password").set(bearer(token)).send({ currentPassword: CURRENT, newPassword: WEAK });
    expect(changed.status).toBe(400);
    expect((await request(app).post("/auth/login").send({ email: user.email, password: CURRENT })).status).toBe(200);
    expect((await request(app).post("/auth/login").send({ email: user.email, password: WEAK })).status).toBe(401);
  });

  it("keeps this browser signed in, ends the others, forgets trusted devices, and sends the notice", async () => {
    const user = await makeUser("sessions");
    const agentA = request.agent(app);
    const first = await agentA.post("/auth/login").send({ email: user.email, password: CURRENT });
    expect(first.status).toBe(200);
    const oldToken = first.body.accessToken as string;
    const [original] = await db.select().from(refreshTokens).where(and(eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt)));

    const agentB = request.agent(app);
    const second = await agentB.post("/auth/login").send({ email: user.email, password: CURRENT });
    const otherToken = second.body.accessToken as string;

    await db.insert(trustedDevices).values({
      userId: user.id,
      tokenHash: createHash("sha256").update(`device-${user.id}`).digest("hex"),
      label: "Office laptop",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    sentMail.length = 0;
    const changed = await agentA.post("/auth/change-password").set(bearer(oldToken)).send({ currentPassword: CURRENT, newPassword: NEXT });
    expect(changed.status).toBe(200);
    expect(changed.body.user.mustChangePassword).toBe(false);
    expect(changed.body.refreshToken).toBeUndefined();
    const newToken = changed.body.accessToken as string;

    expect((await request(app).get("/auth/me").set(bearer(newToken))).status).toBe(200);
    expect((await request(app).get("/auth/me").set(bearer(oldToken))).status).toBe(401);
    expect((await request(app).get("/auth/me").set(bearer(otherToken))).status).toBe(401);
    expect((await agentB.post("/auth/refresh").set(CSRF)).status).toBe(401);
    expect((await agentA.post("/auth/refresh").set(CSRF)).status).toBe(200);

    const rows = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, user.id));
    // The two sign-ins are revoked. The replacement this browser was given is
    // marked used once it refreshes, and the refresh itself is the one still open.
    const open = rows.filter((row) => !row.revokedAt && !row.usedAt);
    expect(rows.filter((row) => row.revokedAt).length).toBeGreaterThanOrEqual(2);
    expect(open).toHaveLength(1);
    expect(open[0]!.expiresAt.getTime()).toBe(original!.expiresAt.getTime());

    const [device] = await db.select().from(trustedDevices).where(eq(trustedDevices.userId, user.id));
    expect(device!.revokedAt).toBeTruthy();

    const actions = await actionsFor(user.id);
    expect(actions.some((entry) => entry?.action === "password_changed")).toBe(true);
    expect(actions.some((entry) => entry?.action === "trusted_devices_revoked" && entry.reason === "password_changed")).toBe(true);

    const notice = sentMail.find((message) => message.to === user.email);
    expect(notice?.subject).toMatch(/password was changed/i);
    expect(notice?.body).not.toContain(CURRENT);
    expect(notice?.body).not.toContain(NEXT);
  });

  it("blocks every other page after a temporary password, including after the authenticator step", async () => {
    const user = await makeUser("forced", { mustChangePassword: true });
    const login = await request(app).post("/auth/login").send({ email: user.email, password: CURRENT });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);
    const token = login.body.accessToken as string;
    expect((await request(app).get("/auth/me").set(bearer(token))).status).toBe(200);
    expect((await request(app).get("/auth/mfa/status").set(bearer(token))).status).toBe(403);

    const changed = await request(app).post("/auth/change-password").set(bearer(token)).send({ currentPassword: CURRENT, newPassword: NEXT });
    expect(changed.status).toBe(200);
    expect(changed.body.user.mustChangePassword).toBe(false);
    expect((await request(app).get("/auth/mfa/status").set(bearer(changed.body.accessToken))).status).toBe(200);

    const mfaUser = await makeUser("forced-mfa");
    const enrolled = await request(app).post("/auth/login").send({ email: mfaUser.email, password: CURRENT });
    const setup = await request(app).post("/auth/mfa/setup").set(bearer(enrolled.body.accessToken));
    const secret = setup.body.secret as string;
    expect((await request(app).post("/auth/mfa/enable").set(bearer(enrolled.body.accessToken)).send({ code: codeAt(secret) })).status).toBe(200);
    await db.update(users).set({ mustChangePassword: true }).where(eq(users.id, mfaUser.id));

    const challenge = await request(app).post("/auth/login").send({ email: mfaUser.email, password: CURRENT });
    expect(challenge.body.mfaRequired).toBe(true);
    expect(challenge.body.accessToken).toBeUndefined();
    const verified = await request(app).post("/auth/mfa/verify").send({ mfaToken: challenge.body.mfaToken, code: codeAt(secret, 1) });
    expect(verified.status).toBe(200);
    expect(verified.body.user.mustChangePassword).toBe(true);
    expect((await request(app).get("/auth/mfa/status").set(bearer(verified.body.accessToken))).status).toBe(403);
    const finished = await request(app)
      .post("/auth/change-password")
      .set(bearer(verified.body.accessToken))
      .send({ currentPassword: CURRENT, newPassword: NEXT });
    expect(finished.status).toBe(200);
    expect((await request(app).get("/auth/mfa/status").set(bearer(finished.body.accessToken))).status).toBe(200);
  });

  it("marks a user an administrator creates, and does not mark people who already have accounts", async () => {
    const admin = await makeUser("admin");
    await db.update(users).set({ roleId: adminRoleId }).where(eq(users.id, admin.id));
    const adminToken = signAccessToken({ sub: String(admin.id), roleId: adminRoleId, roleName: "admin", department: null, tv: 0 });

    const email = `pwchange-created-${suffix}@test.local`;
    const created = await request(app).post("/users").set(bearer(adminToken)).send({ email, password: NEXT, name: "New Person" });
    expect(created.status).toBe(201);
    expect(created.body.mustChangePassword).toBe(true);
    expect(created.body.passwordHash).toBeUndefined();

    const login = await request(app).post("/auth/login").send({ email, password: NEXT });
    expect(login.body.user.mustChangePassword).toBe(true);
    expect((await request(app).get("/auth/mfa/status").set(bearer(login.body.accessToken))).status).toBe(403);

    const existing = await makeUser("existing");
    const [row] = await db.select({ mustChangePassword: users.mustChangePassword }).from(users).where(eq(users.id, existing.id));
    expect(row!.mustChangePassword).toBe(false);
    const session = await request(app).post("/auth/login").send({ email: existing.email, password: CURRENT });
    expect(session.body.user.mustChangePassword).toBe(false);
    expect((await request(app).get("/auth/mfa/status").set(bearer(session.body.accessToken))).status).toBe(200);
  });

  it("an administrator's temporary password ends that person's sessions and devices", async () => {
    const admin = await makeUser("admin-reset");
    await db.update(users).set({ roleId: adminRoleId }).where(eq(users.id, admin.id));
    const adminToken = signAccessToken({ sub: String(admin.id), roleId: adminRoleId, roleName: "admin", department: null, tv: 0 });

    const target = await makeUser("target");
    const agent = request.agent(app);
    const session = await agent.post("/auth/login").send({ email: target.email, password: CURRENT });
    const oldToken = session.body.accessToken as string;
    await db.insert(trustedDevices).values({
      userId: target.id,
      tokenHash: createHash("sha256").update(`reset-device-${target.id}`).digest("hex"),
      label: "Phone",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const reset = await request(app).post(`/users/${target.id}/temporary-password`).set(bearer(adminToken)).send({ password: NEXT });
    expect(reset.status).toBe(204);
    expect((await request(app).get("/auth/me").set(bearer(oldToken))).status).toBe(401);
    expect((await agent.post("/auth/refresh").set(CSRF)).status).toBe(401);
    expect((await request(app).get("/auth/me").set(bearer(adminToken))).status).toBe(200);

    const [device] = await db.select().from(trustedDevices).where(eq(trustedDevices.userId, target.id));
    expect(device!.revokedAt).toBeTruthy();
    const actions = await actionsFor(target.id);
    expect(actions.some((entry) => entry?.action === "temporary_password_set")).toBe(true);
    expect(actions.some((entry) => entry?.action === "trusted_devices_revoked" && entry.reason === "temporary_password_set")).toBe(true);

    const login = await request(app).post("/auth/login").send({ email: target.email, password: NEXT });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);
    expect((await request(app).get("/auth/mfa/status").set(bearer(login.body.accessToken))).status).toBe(403);
  });

  it("a self-service reset clears the must-change flag", async () => {
    const user = await makeUser("self-reset", { mustChangePassword: true });
    const token = "pwchange-reset-token";
    await db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect((await request(app).post("/auth/reset-password").send({ token, newPassword: NEXT })).status).toBe(200);
    const login = await request(app).post("/auth/login").send({ email: user.email, password: NEXT });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(false);
    expect((await request(app).get("/auth/mfa/status").set(bearer(login.body.accessToken))).status).toBe(200);
  });
});
