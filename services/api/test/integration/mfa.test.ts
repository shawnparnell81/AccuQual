// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// TOTP multi-factor authentication: enrollment, the two-step sign-in, replay and
// recovery-code handling, the tenant policy (optional / admins / all) with its
// grace period, platform_admin always being required, and admin reset.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { refreshTokens } from "../../src/drizzle/schema/refreshTokens.js";
import { mfaRecoveryCodes } from "../../src/drizzle/schema/mfaRecoveryCodes.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { auditRowChanges } from "../../src/drizzle/schema/auditRowChanges.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { totpAt, totpCounter } from "../../src/utils/totp.js";
import { decryptSecret } from "../../src/modules/tenant/crypto.js";
import { env } from "../../src/config/env.js";

const app = createApp();
const suffix = Date.now();
const PASSWORD = "violet-lantern-quarry-88";
const CSRF = { "X-AccuQual-Csrf": "1" };
const DAY = 86_400_000;

let tenantId: number;
let adminRoleId: number;
let platformRoleId: number;
const userIds: number[] = [];
const createdRoleIds: number[] = [];

async function ensureRole(name: string): Promise<number> {
  const [existing] = await db.select().from(roles).where(eq(roles.name, name));
  if (existing) return existing.id;
  const [r] = await db.insert(roles).values({ name }).returning();
  createdRoleIds.push(r!.id);
  return r!.id;
}

async function makeUser(label: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const email = `mfa-${label}-${suffix}@test.local`;
  const [u] = await db.insert(users).values({ tenantId, email, passwordHash: await bcrypt.hash(PASSWORD, 4), ...extra }).returning();
  userIds.push(u!.id);
  return { id: u!.id, email };
}
const login = (email: string, password = PASSWORD) => request(app).post("/auth/login").send({ email, password });
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
/** A code that is valid now but was not the last one used — the step before, which the ±1 window still accepts. */
const codeAt = (secret: string, stepOffset = 0) => totpAt(secret, totpCounter() + stepOffset);

/** Enrolls a signed-in user through the real endpoints and returns their plaintext secret + recovery codes. */
async function enroll(token: string) {
  const setup = await request(app).post("/auth/mfa/setup").set(bearer(token));
  expect(setup.status).toBe(200);
  const secret = setup.body.secret as string;
  const enable = await request(app).post("/auth/mfa/enable").set(bearer(token)).send({ code: codeAt(secret) });
  expect(enable.status).toBe(200);
  return { secret, recoveryCodes: enable.body.recoveryCodes as string[] };
}

describe("TOTP multi-factor authentication (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [t] = await db.insert(tenants).values({ name: `MFA Test ${suffix}`, code: `mfa-${suffix}` }).returning();
    tenantId = t!.id;
    adminRoleId = await ensureRole("admin");
    platformRoleId = await ensureRole("platform_admin");
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditRowChanges).where(eq(auditRowChanges.tenantId, tenantId));
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, tenantId));
    await db.delete(mfaRecoveryCodes).where(inArray(mfaRecoveryCodes.userId, userIds));
    await db.delete(refreshTokens).where(inArray(refreshTokens.userId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
    if (createdRoleIds.length) await db.delete(roles).where(inArray(roles.id, createdRoleIds));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await db.delete(auditRowChanges).where(eq(auditRowChanges.tenantId, tenantId));
    await pool.end();
  });

  describe("voluntary enrollment and the two-step sign-in", () => {
    it("a user can turn MFA on, after which the password alone no longer signs them in", async () => {
      const u = await makeUser("basic");
      const first = await login(u.email);
      expect(first.status).toBe(200);
      const token = first.body.accessToken as string;

      const { secret, recoveryCodes } = await enroll(token);
      expect(recoveryCodes).toHaveLength(10);
      expect(recoveryCodes[0]).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);

      const second = await login(u.email);
      expect(second.status).toBe(200);
      expect(second.body.mfaRequired).toBe(true);
      expect(second.body.accessToken).toBeUndefined();
      expect(second.headers["set-cookie"]).toBeUndefined();

      // Step before the one used at enrollment would be replay; use the next step forward.
      const done = await request(app).post("/auth/mfa/verify").send({ mfaToken: second.body.mfaToken, code: codeAt(secret, 1) });
      expect(done.status).toBe(200);
      expect(done.body.accessToken).toBeTruthy();
      expect(done.body.refreshToken).toBeUndefined();
      expect((done.headers["set-cookie"] as unknown as string[]).some((c) => c.startsWith("accuqual_rt="))).toBe(true);
      expect((await request(app).get("/auth/me").set(bearer(done.body.accessToken))).body.mfaEnabled).toBe(true);
    });

    it("a wrong code is refused, and a code cannot be replayed", async () => {
      const u = await makeUser("replay");
      const { secret } = await enroll((await login(u.email)).body.accessToken);

      const challenge = (await login(u.email)).body.mfaToken as string;
      expect((await request(app).post("/auth/mfa/verify").send({ mfaToken: challenge, code: "000000" })).status).toBe(401);

      const good = codeAt(secret, 1);
      expect((await request(app).post("/auth/mfa/verify").send({ mfaToken: challenge, code: good })).status).toBe(200);
      const again = (await login(u.email)).body.mfaToken as string;
      expect((await request(app).post("/auth/mfa/verify").send({ mfaToken: again, code: good })).status).toBe(401);
    });

    it("recovery codes work exactly once", async () => {
      const u = await makeUser("recovery");
      const { recoveryCodes } = await enroll((await login(u.email)).body.accessToken);

      const t1 = (await login(u.email)).body.mfaToken as string;
      expect((await request(app).post("/auth/mfa/verify").send({ mfaToken: t1, code: recoveryCodes[0] })).status).toBe(200);
      const t2 = (await login(u.email)).body.mfaToken as string;
      expect((await request(app).post("/auth/mfa/verify").send({ mfaToken: t2, code: recoveryCodes[0] })).status).toBe(401);
      const t3 = (await login(u.email)).body.mfaToken as string;
      expect((await request(app).post("/auth/mfa/verify").send({ mfaToken: t3, code: recoveryCodes[1]!.toLowerCase().replace("-", "") })).status).toBe(200);

      const session = (await request(app).post("/auth/mfa/verify").send({ mfaToken: (await login(u.email)).body.mfaToken, code: recoveryCodes[2] })).body.accessToken as string;
      const status = await request(app).get("/auth/mfa/status").set(bearer(session));
      expect(status.body).toMatchObject({ enabled: true, recoveryCodesRemaining: 7 });
    });

    it("repeated wrong codes lock the account like wrong passwords do", async () => {
      const u = await makeUser("lockcodes");
      await enroll((await login(u.email)).body.accessToken);
      const challenge = (await login(u.email)).body.mfaToken as string;
      for (let i = 0; i < env.LOGIN_MAX_FAILURES; i++) {
        expect((await request(app).post("/auth/mfa/verify").send({ mfaToken: challenge, code: "000000" })).status).toBe(401);
      }
      expect((await login(u.email)).status).toBe(429);
    });

    it("the secret is stored encrypted and never leaves the server after setup", async () => {
      const u = await makeUser("secret");
      const token = (await login(u.email)).body.accessToken as string;
      const { secret } = await enroll(token);

      const [row] = await db.select().from(users).where(eq(users.id, u.id));
      expect(row!.mfaSecretEncrypted).toBeTruthy();
      expect(row!.mfaSecretEncrypted).not.toContain(secret);
      expect(decryptSecret(row!.mfaSecretEncrypted!)).toBe(secret);

      const me = await request(app).get("/auth/me").set(bearer(token));
      expect(JSON.stringify(me.body)).not.toContain(secret);
      expect(me.body.mfaSecretEncrypted).toBeUndefined();

      const changes = await db.select().from(auditRowChanges).where(eq(auditRowChanges.rowId, u.id));
      expect(JSON.stringify(changes)).not.toContain(secret);
      expect(JSON.stringify(changes)).not.toContain(row!.mfaSecretEncrypted!);
    });

    it("challenge tokens are single-purpose and an access token is not a challenge token", async () => {
      const u = await makeUser("purpose");
      const token = (await login(u.email)).body.accessToken as string;
      const { secret } = await enroll(token);
      const verifyToken = (await login(u.email)).body.mfaToken as string;

      expect((await request(app).post("/auth/mfa/enroll/start").send({ mfaToken: verifyToken })).status).toBe(401);
      expect((await request(app).post("/auth/mfa/verify").send({ mfaToken: token, code: codeAt(secret, 1) })).status).toBe(401);
    });
  });

  describe("turning it off, and regenerating recovery codes", () => {
    it("needs the password AND a current code; wrong ones change nothing", async () => {
      const u = await makeUser("disable");
      const token = (await login(u.email)).body.accessToken as string;
      const { secret } = await enroll(token);

      expect((await request(app).post("/auth/mfa/disable").set(bearer(token)).send({ password: "wrong-password-here", code: codeAt(secret, 1) })).status).toBe(401);
      expect((await request(app).post("/auth/mfa/disable").set(bearer(token)).send({ password: PASSWORD, code: "000000" })).status).toBe(401);
      expect((await login(u.email)).body.mfaRequired).toBe(true);

      expect((await request(app).post("/auth/mfa/disable").set(bearer(token)).send({ password: PASSWORD, code: codeAt(secret, 1) })).status).toBe(204);
      const after = await login(u.email);
      expect(after.body.mfaRequired).toBeUndefined();
      expect(after.body.accessToken).toBeTruthy();
      expect(await db.select().from(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, u.id))).toHaveLength(0);
    });

    it("regenerating recovery codes invalidates the old set", async () => {
      const u = await makeUser("regen");
      const token = (await login(u.email)).body.accessToken as string;
      const { secret, recoveryCodes: oldCodes } = await enroll(token);

      const res = await request(app).post("/auth/mfa/recovery-codes").set(bearer(token)).send({ password: PASSWORD, code: codeAt(secret, 1) });
      expect(res.status).toBe(200);
      expect(res.body.recoveryCodes).toHaveLength(10);

      const challenge = (await login(u.email)).body.mfaToken as string;
      expect((await request(app).post("/auth/mfa/verify").send({ mfaToken: challenge, code: oldCodes[0] })).status).toBe(401);
      expect((await request(app).post("/auth/mfa/verify").send({ mfaToken: challenge, code: res.body.recoveryCodes[0] })).status).toBe(200);
    });
  });

  describe("tenant policy", () => {
    it("default 'admins': an admin gets a grace period, then is stopped at sign-in and must enroll", async () => {
      await db.update(tenants).set({ mfaPolicy: "admins" }).where(eq(tenants.id, tenantId));
      const admin = await makeUser("admin-grace", { roleId: adminRoleId });

      const inGrace = await login(admin.email);
      expect(inGrace.status).toBe(200);
      expect(inGrace.body.accessToken).toBeTruthy();
      expect(new Date(inGrace.body.mfaGraceEndsAt).getTime()).toBeGreaterThan(Date.now() + (env.MFA_ENROLLMENT_GRACE_DAYS - 1) * DAY);
      const status = await request(app).get("/auth/mfa/status").set(bearer(inGrace.body.accessToken));
      expect(status.body).toMatchObject({ enabled: false, required: true, state: "grace" });

      await db.update(users).set({ mfaRequiredSince: new Date(Date.now() - (env.MFA_ENROLLMENT_GRACE_DAYS + 1) * DAY) }).where(eq(users.id, admin.id));
      const blocked = await login(admin.email);
      expect(blocked.body.mfaEnrollmentRequired).toBe(true);
      expect(blocked.body.accessToken).toBeUndefined();

      const start = await request(app).post("/auth/mfa/enroll/start").send({ mfaToken: blocked.body.mfaToken });
      expect(start.status).toBe(200);
      expect(start.body.otpauthUri).toContain("otpauth://totp/");
      const bad = await request(app).post("/auth/mfa/enroll/confirm").send({ mfaToken: blocked.body.mfaToken, code: "000000" });
      expect(bad.status).toBe(400);
      const ok = await request(app).post("/auth/mfa/enroll/confirm").send({ mfaToken: blocked.body.mfaToken, code: codeAt(start.body.secret) });
      expect(ok.status).toBe(200);
      expect(ok.body.accessToken).toBeTruthy();
      expect(ok.body.recoveryCodes).toHaveLength(10);
      expect((await login(admin.email)).body.mfaRequired).toBe(true);
    });

    it("an admin cannot turn MFA off while the policy requires it", async () => {
      const admin = await makeUser("admin-required", { roleId: adminRoleId });
      const token = (await login(admin.email)).body.accessToken as string;
      const { secret } = await enroll(token);
      const res = await request(app).post("/auth/mfa/disable").set(bearer(token)).send({ password: PASSWORD, code: codeAt(secret, 1) });
      expect(res.status).toBe(403);
      expect((await login(admin.email)).body.mfaRequired).toBe(true);
    });

    it("'admins' leaves ordinary users alone, 'all' requires everyone, 'optional' requires no one", async () => {
      const worker = await makeUser("worker-policy");
      const admin = await makeUser("admin-policy", { roleId: adminRoleId, mfaRequiredSince: new Date(Date.now() - 30 * DAY) });

      await db.update(tenants).set({ mfaPolicy: "admins" }).where(eq(tenants.id, tenantId));
      expect((await login(worker.email)).body.accessToken).toBeTruthy();
      expect((await login(admin.email)).body.mfaEnrollmentRequired).toBe(true);

      await db.update(tenants).set({ mfaPolicy: "optional" }).where(eq(tenants.id, tenantId));
      expect((await login(admin.email)).body.accessToken).toBeTruthy();

      await db.update(tenants).set({ mfaPolicy: "all" }).where(eq(tenants.id, tenantId));
      await db.update(users).set({ mfaRequiredSince: new Date(Date.now() - 30 * DAY) }).where(eq(users.id, worker.id));
      expect((await login(worker.email)).body.mfaEnrollmentRequired).toBe(true);

      await db.update(tenants).set({ mfaPolicy: "admins" }).where(eq(tenants.id, tenantId));
    });

    it("a session cannot be refreshed once its owner has become subject to MFA and the grace period has ended", async () => {
      await db.update(tenants).set({ mfaPolicy: "optional" }).where(eq(tenants.id, tenantId));
      const admin = await makeUser("admin-refresh", { roleId: adminRoleId });
      const agent = request.agent(app);
      expect((await agent.post("/auth/login").send({ email: admin.email, password: PASSWORD })).status).toBe(200);
      expect((await agent.post("/auth/refresh").set(CSRF)).status).toBe(200);

      await db.update(tenants).set({ mfaPolicy: "admins" }).where(eq(tenants.id, tenantId));
      await db.update(users).set({ mfaRequiredSince: new Date(Date.now() - 30 * DAY) }).where(eq(users.id, admin.id));
      const res = await agent.post("/auth/refresh").set(CSRF);
      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/Multi-factor/);
    });

    it("platform_admin always needs MFA — no grace period, whatever the tenant policy says", async () => {
      await db.update(tenants).set({ mfaPolicy: "optional" }).where(eq(tenants.id, tenantId));
      const [pa] = await db
        .insert(users)
        .values({ tenantId: null, email: `mfa-platform-${suffix}@test.local`, passwordHash: await bcrypt.hash(PASSWORD, 4), roleId: platformRoleId })
        .returning();
      userIds.push(pa!.id);
      const res = await login(pa!.email);
      expect(res.body.mfaEnrollmentRequired).toBe(true);
      expect(res.body.accessToken).toBeUndefined();
      await db.update(tenants).set({ mfaPolicy: "admins" }).where(eq(tenants.id, tenantId));
    });

    it("an admin can read and change the tenant policy; a non-admin cannot change it", async () => {
      const admin = await makeUser("policy-admin", { roleId: adminRoleId });
      const adminToken = await signAccessToken({ sub: String(admin.id), tenantId, roleId: adminRoleId, roleName: "admin", department: null });
      const worker = await makeUser("policy-worker");
      const workerToken = await signAccessToken({ sub: String(worker.id), tenantId, roleId: null, roleName: null, department: null });

      expect((await request(app).patch("/tenant/security").set(bearer(workerToken)).send({ mfaPolicy: "all" })).status).toBe(403);
      expect((await request(app).patch("/tenant/security").set(bearer(adminToken)).send({ mfaPolicy: "bogus" })).status).toBe(400);
      expect((await request(app).patch("/tenant/security").set(bearer(adminToken)).send({ mfaPolicy: "all" })).body).toEqual({ mfaPolicy: "all" });
      expect((await request(app).get("/tenant/security").set(bearer(workerToken))).body).toEqual({ mfaPolicy: "all" });
      await db.update(tenants).set({ mfaPolicy: "admins" }).where(eq(tenants.id, tenantId));
    });
  });

  describe("admin reset", () => {
    it("clears a user's second factor and ends their sessions", async () => {
      const admin = await makeUser("reset-admin", { roleId: adminRoleId });
      const adminToken = await signAccessToken({ sub: String(admin.id), tenantId, roleId: adminRoleId, roleName: "admin", department: null });
      const u = await makeUser("reset-target");
      const userToken = (await login(u.email)).body.accessToken as string;
      await enroll(userToken);
      const live = (await request(app).post("/auth/mfa/verify").send({ mfaToken: (await login(u.email)).body.mfaToken, code: "000000" })).status;
      expect(live).toBe(401);

      expect((await request(app).post(`/users/${u.id}/mfa/reset`).set(bearer(adminToken))).status).toBe(204);
      expect((await request(app).get("/auth/me").set(bearer(userToken))).status).toBe(401);
      const after = await login(u.email);
      expect(after.body.mfaRequired).toBeUndefined();
      expect(after.body.accessToken).toBeTruthy();

      const worker = await makeUser("reset-nonadmin");
      const workerToken = await signAccessToken({ sub: String(worker.id), tenantId, roleId: null, roleName: null, department: null });
      expect((await request(app).post(`/users/${u.id}/mfa/reset`).set(bearer(workerToken))).status).toBe(403);
    });
  });
});
