import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Login hardening: lockout after repeated wrong passwords (audited, cleared by
// a good login / reset / admin unlock), the password policy, the idle
// timeout, and session revocation when a user is disabled or has their role
// changed — including that an already-issued access token stops working at once.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { refreshTokens } from "../../src/drizzle/schema/refreshTokens.js";
import { passwordResetTokens } from "../../src/drizzle/schema/passwordResetTokens.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { auditRowChanges } from "../../src/drizzle/schema/auditRowChanges.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { passwordProblem } from "../../src/utils/passwordPolicy.js";
import { env } from "../../src/config/env.js";

const app = createApp();
const suffix = Date.now();
const GOOD = "violet-lantern-quarry-88";
const CSRF = { "X-AccuQual-Csrf": "1" };

let companyId: number;
let adminId: number;
let adminToken: string;
const roleIds: number[] = [];
const userIds: number[] = [];
const auth = () => ({ Authorization: `Bearer ${adminToken}` });

async function makeUser(label: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const email = `login-hard-${label}-${suffix}@test.local`;
  const [u] = await db.insert(users).values({ email, passwordHash: await bcrypt.hash(GOOD, 4), ...extra }).returning();
  userIds.push(u!.id);
  return { id: u!.id, email };
}
const login = (email: string, password: string) => request(app).post("/auth/login").send({ email, password });

describe("Login hardening (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const t = await ensureTestCompany();
    companyId = t!.id;
    const inserted = await db.insert(roles).values([{ name: `login-hard-r1-${suffix}` }, { name: `login-hard-r2-${suffix}` }]).returning();
    roleIds.push(...inserted.map((r) => r.id));
    const admin = await makeUser("admin");
    adminId = admin.id;
    adminToken = await signAccessToken({ sub: String(adminId), roleId: null, roleName: "admin", department: null });
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  describe("account lockout", () => {
    it("locks after the configured number of wrong passwords, refuses even the right one, and writes an audit entry", async () => {
      const u = await makeUser("lock");
      for (let i = 0; i < env.LOGIN_MAX_FAILURES; i++) {
        expect((await login(u.email, "wrong-password-value")).status).toBe(401);
      }
      const locked = await login(u.email, GOOD);
      expect(locked.status).toBe(429);
      expect(locked.body.message).toMatch(/Try again in/);

      const [row] = await db.select().from(users).where(eq(users.id, u.id));
      expect(row!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

      const entries = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "User"), eq(auditTrail.entityId, u.id)));
      const lockEntry = entries.find((e) => (e.changes as { action?: string } | null)?.action === "account_locked");
      expect(lockEntry).toBeTruthy();
      expect((lockEntry!.changes as { failedAttempts: number }).failedAttempts).toBe(env.LOGIN_MAX_FAILURES);
    });

    it("guessing during the lock does not extend it", async () => {
      const u = await makeUser("noextend", { lockedUntil: new Date(Date.now() + 5 * 60_000) });
      const before = (await db.select().from(users).where(eq(users.id, u.id)))[0]!.lockedUntil!.getTime();
      await login(u.email, "wrong-password-value");
      const after = (await db.select().from(users).where(eq(users.id, u.id)))[0]!.lockedUntil!.getTime();
      expect(after).toBe(before);
    });

    it("an expired lock lets the right password in and clears the counters", async () => {
      const u = await makeUser("expired", { lockedUntil: new Date(Date.now() - 1000), failedLoginCount: 3, firstFailedLoginAt: new Date() });
      const res = await login(u.email, GOOD);
      expect(res.status).toBe(200);
      const [row] = await db.select().from(users).where(eq(users.id, u.id));
      expect(row).toMatchObject({ lockedUntil: null, failedLoginCount: 0, firstFailedLoginAt: null });
    });

    it("failures spread outside the window do not add up to a lock", async () => {
      const u = await makeUser("window", { failedLoginCount: env.LOGIN_MAX_FAILURES - 1, firstFailedLoginAt: new Date(Date.now() - (env.LOGIN_FAILURE_WINDOW_MINUTES + 1) * 60_000) });
      expect((await login(u.email, "wrong-password-value")).status).toBe(401);
      const [row] = await db.select().from(users).where(eq(users.id, u.id));
      expect(row!.lockedUntil).toBeNull();
      expect(row!.failedLoginCount).toBe(1);
    });

    it("a good login resets a partial failure count", async () => {
      const u = await makeUser("reset");
      await login(u.email, "wrong-password-value");
      await login(u.email, "wrong-password-value");
      expect((await login(u.email, GOOD)).status).toBe(200);
      expect((await db.select().from(users).where(eq(users.id, u.id)))[0]!.failedLoginCount).toBe(0);
    });

    it("an admin can unlock the account, and it is audited", async () => {
      const u = await makeUser("adminunlock", { lockedUntil: new Date(Date.now() + 10 * 60_000) });
      const res = await request(app).post(`/users/${u.id}/unlock`).set(auth());
      expect(res.status).toBe(204);
      expect((await login(u.email, GOOD)).status).toBe(200);
      const entries = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "User"), eq(auditTrail.entityId, u.id)));
      expect(entries.some((e) => (e.changes as { action?: string } | null)?.action === "account_unlocked" && e.performedBy === adminId)).toBe(true);
    });
  });

  describe("email case-insensitivity", () => {
    it("logs in regardless of how the caller cases the email, and still fails on a genuinely unknown one", async () => {
      const u = await makeUser("casing");
      expect((await login(u.email.toUpperCase(), GOOD)).status).toBe(200);
      expect((await login(`Login-Hard-Casing-${suffix}@Test.Local`, GOOD)).status).toBe(200);
      expect((await login(`not-${u.email}`, GOOD)).status).toBe(401);
    });
  });

  describe("password policy", () => {
    it("rejects short, common, sequential, repetitive and email-derived passwords", () => {
      expect(passwordProblem("Sh0rt!pw")).toMatch(/at least 12/);
      expect(passwordProblem("Password123456")).toMatch(/common|easy/);
      expect(passwordProblem("P@ssw0rd!!!!!")).toMatch(/common|easy/);
      expect(passwordProblem("abcdefghijklmn")).toMatch(/sequence/);
      expect(passwordProblem("aaaaaaaaaaaaaaaa")).toMatch(/repetitive/);
      expect(passwordProblem("jane.doe-2024-xyz", { email: "jane.doe@acme.com" })).toMatch(/email/);
      expect(passwordProblem(GOOD)).toBeNull();
    });

    it("the API refuses a weak password when creating a user and accepts a strong one", async () => {
      const weak = await request(app).post("/users").set(auth()).send({ email: `login-hard-weak-${suffix}@test.local`, password: "password1234" });
      expect(weak.status).toBe(400);
      const ok = await request(app).post("/users").set(auth()).send({ email: `login-hard-strong-${suffix}@test.local`, password: GOOD });
      expect(ok.status).toBe(201);
      userIds.push(ok.body.id);
    });

    it("password reset enforces it too", async () => {
      const u = await makeUser("resetpw", { lockedUntil: new Date(Date.now() + 10 * 60_000) });
      const { createHash } = await import("node:crypto");
      await db.insert(passwordResetTokens).values({ userId: u.id, tokenHash: createHash("sha256").update("tok-weak").digest("hex"), expiresAt: new Date(Date.now() + 60_000) });
      await db.insert(passwordResetTokens).values({ userId: u.id, tokenHash: createHash("sha256").update("tok-good").digest("hex"), expiresAt: new Date(Date.now() + 60_000) });
      expect((await request(app).post("/auth/reset-password").send({ token: "tok-weak", newPassword: "letmein123456" })).status).toBe(400);
      expect((await request(app).post("/auth/reset-password").send({ token: "tok-good", newPassword: "granite-meadow-lamp-42" })).status).toBe(200);
      // resetting also clears the lockout
      expect((await login(u.email, "granite-meadow-lamp-42")).status).toBe(200);
    });
  });

  describe("sessions", () => {
    it("ends a session that has been idle longer than the timeout", async () => {
      const u = await makeUser("idle");
      const agent = request.agent(app);
      const res = await agent.post("/auth/login").send({ email: u.email, password: GOOD });
      expect(res.status).toBe(200);
      await db.update(refreshTokens).set({ createdAt: new Date(Date.now() - (env.SESSION_IDLE_TIMEOUT_MINUTES + 5) * 60_000) }).where(eq(refreshTokens.userId, u.id));
      const refreshed = await agent.post("/auth/refresh").set(CSRF);
      expect(refreshed.status).toBe(401);
      expect(refreshed.body.message).toMatch(/inactivity/);
    });

    it("keeps a recently used session alive", async () => {
      const u = await makeUser("active");
      const agent = request.agent(app);
      await agent.post("/auth/login").send({ email: u.email, password: GOOD });
      expect((await agent.post("/auth/refresh").set(CSRF)).status).toBe(200);
    });

    it("disabling a user kills their live access token and refresh token immediately", async () => {
      const u = await makeUser("disable");
      const agent = request.agent(app);
      const session = await agent.post("/auth/login").send({ email: u.email, password: GOOD });
      const token = session.body.accessToken as string;
      expect((await request(app).get("/auth/me").set({ Authorization: `Bearer ${token}` })).status).toBe(200);

      expect((await request(app).patch(`/users/${u.id}`).set(auth()).send({ isActive: false })).status).toBe(200);

      expect((await request(app).get("/auth/me").set({ Authorization: `Bearer ${token}` })).status).toBe(401);
      expect((await agent.post("/auth/refresh").set(CSRF)).status).toBe(401);
      expect((await login(u.email, GOOD)).status).toBe(403);
    });

    it("changing a user's role revokes their sessions so they sign in again with the new permissions", async () => {
      const u = await makeUser("rolechange", { roleId: roleIds[0] });
      const session = await login(u.email, GOOD);
      const token = session.body.accessToken as string;

      expect((await request(app).patch(`/users/${u.id}`).set(auth()).send({ roleId: roleIds[1] })).status).toBe(200);
      expect((await request(app).get("/auth/me").set({ Authorization: `Bearer ${token}` })).status).toBe(401);

      const again = await login(u.email, GOOD);
      expect(again.status).toBe(200);
      expect((await request(app).get("/auth/me").set({ Authorization: `Bearer ${again.body.accessToken}` })).status).toBe(200);
    });

    it("an edit that changes neither role, department nor active state leaves sessions alone", async () => {
      const u = await makeUser("rename");
      const session = await login(u.email, GOOD);
      expect((await request(app).patch(`/users/${u.id}`).set(auth()).send({ name: "Renamed" })).status).toBe(200);
      expect((await request(app).get("/auth/me").set({ Authorization: `Bearer ${session.body.accessToken}` })).status).toBe(200);
    });

    it("deactivating via DELETE also revokes the live token", async () => {
      const u = await makeUser("delete");
      const token = (await login(u.email, GOOD)).body.accessToken as string;
      expect((await request(app).delete(`/users/${u.id}`).set(auth())).status).toBe(204);
      expect((await request(app).get("/auth/me").set({ Authorization: `Bearer ${token}` })).status).toBe(401);
    });
  });
});
