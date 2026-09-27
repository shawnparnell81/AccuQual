import { ensureTestCompany } from "../helpers/company.js";
// A browser can skip the authenticator code for 30 days after the user opts in
// on the code step. The password is still required. The 30 days do not move
// when the device is used again.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { trustedDevices } from "../../src/drizzle/schema/trustedDevices.js";
import { passwordResetTokens } from "../../src/drizzle/schema/passwordResetTokens.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { totpAt, totpCounter } from "../../src/utils/totp.js";
import { TRUSTED_DEVICE_COOKIE_NAME } from "../../src/modules/auth/auth.controller.js";

const app = createApp();
const suffix = Date.now();
const PASSWORD = "violet-lantern-quarry-88";
const NEW_PASSWORD = "granite-meadow-lamp-42";
const CSRF = { "X-AccuQual-Csrf": "1" };
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

let adminRoleId: number;

async function ensureRole(name: string): Promise<number> {
  const [existing] = await db.select().from(roles).where(eq(roles.name, name));
  if (existing) return existing.id;
  const [created] = await db.insert(roles).values({ name }).onConflictDoNothing().returning();
  if (created) return created.id;
  return (await db.select().from(roles).where(eq(roles.name, name)))[0]!.id;
}

async function makeUser(label: string) {
  const email = `trusted-${label}-${suffix}@test.local`;
  const [user] = await db.insert(users).values({ email, passwordHash: await bcrypt.hash(PASSWORD, 4) }).returning();
  return { id: user!.id, email };
}

const codeAt = (secret: string, stepOffset = 0) => totpAt(secret, totpCounter() + stepOffset);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

function setCookieHeader(res: request.Response, name: string): string | undefined {
  const headers = res.headers["set-cookie"] as unknown as string[] | undefined;
  return headers?.find((header) => header.startsWith(`${name}=`));
}

function cookieValue(header: string, name: string): string {
  return decodeURIComponent(header.split(";")[0]!.slice(name.length + 1));
}

/** Turns MFA on through the real endpoints and returns the plaintext secret. */
async function enroll(email: string) {
  const first = await request(app).post("/auth/login").send({ email, password: PASSWORD });
  expect(first.status).toBe(200);
  const token = first.body.accessToken as string;
  const setup = await request(app).post("/auth/mfa/setup").set(bearer(token));
  expect(setup.status).toBe(200);
  const secret = setup.body.secret as string;
  const enable = await request(app).post("/auth/mfa/enable").set(bearer(token)).send({ code: codeAt(secret) });
  expect(enable.status).toBe(200);
  return secret;
}

async function actionsFor(userId: number) {
  const rows = await db.select().from(auditTrail).where(eq(auditTrail.entityId, userId));
  return rows.filter((row) => row.entityType === "User").map((row) => (row.changes as { action?: string } | null)?.action);
}

describe("trusted devices (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    await ensureTestCompany();
    adminRoleId = await ensureRole("admin");
  });

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await pool.end();
  });

  it("the first sign-in on a device requires the authenticator code", async () => {
    const user = await makeUser("first");
    const secret = await enroll(user.email);

    const challenge = await request(app).post("/auth/login").send({ email: user.email, password: PASSWORD });
    expect(challenge.status).toBe(200);
    expect(challenge.body.mfaRequired).toBe(true);
    expect(challenge.body.accessToken).toBeUndefined();
    expect(challenge.headers["set-cookie"]).toBeUndefined();

    const verified = await request(app)
      .post("/auth/mfa/verify")
      .send({ mfaToken: challenge.body.mfaToken, code: codeAt(secret, 1), trustDevice: false });
    expect(verified.status).toBe(200);
    expect(verified.body.accessToken).toBeTruthy();
    expect(verified.body.trustedDeviceToken).toBeUndefined();
    expect(setCookieHeader(verified, TRUSTED_DEVICE_COOKIE_NAME)).toBeUndefined();

    const again = await request(app).post("/auth/login").send({ email: user.email, password: PASSWORD });
    expect(again.body.mfaRequired).toBe(true);
    expect(again.body.accessToken).toBeUndefined();
  });

  it("a second sign-in within 30 days on the same device skips the code", async () => {
    const user = await makeUser("skip");
    const secret = await enroll(user.email);
    const agent = request.agent(app);

    const challenge = await agent.post("/auth/login").send({ email: user.email, password: PASSWORD });
    expect(challenge.body.mfaRequired).toBe(true);

    const verified = await agent
      .post("/auth/mfa/verify")
      .set("User-Agent", CHROME)
      .send({ mfaToken: challenge.body.mfaToken, code: codeAt(secret, 1), trustDevice: true });
    expect(verified.status).toBe(200);
    expect(verified.body.accessToken).toBeTruthy();
    expect(verified.body.trustedDeviceToken).toBeUndefined();
    expect(JSON.stringify(verified.body)).not.toContain("tokenHash");

    const cookie = setCookieHeader(verified, TRUSTED_DEVICE_COOKIE_NAME);
    expect(cookie).toBeTruthy();
    const lowered = cookie!.toLowerCase();
    expect(lowered).toContain("httponly");
    expect(lowered).toContain("path=/");
    expect(lowered).toContain("samesite=lax");
    expect(lowered).not.toContain("domain=");
    expect(lowered).toContain("max-age=2592000");
    expect(lowered).not.toContain("secure");
    const raw = cookieValue(cookie!, TRUSTED_DEVICE_COOKIE_NAME);
    expect(raw.length).toBeGreaterThan(32);
    expect(raw.split(".")).toHaveLength(3);

    const [stored] = await db.select().from(trustedDevices).where(eq(trustedDevices.userId, user.id));
    expect(stored!.tokenHash).not.toBe(raw);
    expect(stored!.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored!.label).toBe("Chrome on Windows");
    expect(stored!.revokedAt).toBeNull();
    const expiresAt = stored!.expiresAt.getTime();
    expect(expiresAt).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
    expect(expiresAt).toBeLessThan(Date.now() + 31 * 24 * 60 * 60 * 1000);

    const second = await agent.post("/auth/login").set(CSRF).send({ email: user.email, password: PASSWORD });
    expect(second.status).toBe(200);
    expect(second.body.mfaRequired).toBeUndefined();
    expect(second.body.accessToken).toBeTruthy();
    expect(setCookieHeader(second, TRUSTED_DEVICE_COOKIE_NAME)).toBeUndefined();

    const [used] = await db.select().from(trustedDevices).where(eq(trustedDevices.id, stored!.id));
    expect(used!.expiresAt.getTime()).toBe(expiresAt);
    expect(used!.lastUsedAt).toBeTruthy();
    expect(await actionsFor(user.id)).toEqual(expect.arrayContaining(["trusted_device_created", "trusted_device_used"]));

    const listed = await agent.get("/auth/trusted-devices").set(bearer(second.body.accessToken));
    expect(listed.status).toBe(200);
    expect(listed.body.devices).toEqual([
      expect.objectContaining({ id: stored!.id, label: "Chrome on Windows", current: true }),
    ]);
    expect(JSON.stringify(listed.body)).not.toContain(stored!.tokenHash);
  });

  it("an expired trusted device requires the code again", async () => {
    const user = await makeUser("expired");
    const secret = await enroll(user.email);
    const agent = request.agent(app);

    const challenge = await agent.post("/auth/login").send({ email: user.email, password: PASSWORD });
    const verified = await agent.post("/auth/mfa/verify").send({ mfaToken: challenge.body.mfaToken, code: codeAt(secret, 1), trustDevice: true });
    expect(verified.status).toBe(200);

    const [row] = await db.select().from(trustedDevices).where(eq(trustedDevices.userId, user.id));
    const expiredAt = new Date(Date.now() - 60_000);
    await db.update(trustedDevices).set({ expiresAt: expiredAt }).where(eq(trustedDevices.id, row!.id));

    const again = await agent.post("/auth/login").set(CSRF).send({ email: user.email, password: PASSWORD });
    expect(again.status).toBe(200);
    expect(again.body.mfaRequired).toBe(true);
    expect(again.body.accessToken).toBeUndefined();

    const [still] = await db.select().from(trustedDevices).where(eq(trustedDevices.id, row!.id));
    expect(still!.expiresAt.getTime()).toBe(expiredAt.getTime());
    expect(still!.lastUsedAt).toBeNull();
    expect(still!.revokedAt).toBeNull();
  });

  it("a trusted-device token for a different user is ignored", async () => {
    const owner = await makeUser("owner");
    const other = await makeUser("other");
    const ownerSecret = await enroll(owner.email);
    const otherSecret = await enroll(other.email);
    const agent = request.agent(app);

    const challenge = await agent.post("/auth/login").send({ email: owner.email, password: PASSWORD });
    expect((await agent.post("/auth/mfa/verify").send({ mfaToken: challenge.body.mfaToken, code: codeAt(ownerSecret, 1), trustDevice: true })).status).toBe(200);

    const asOther = await agent.post("/auth/login").set(CSRF).send({ email: other.email, password: PASSWORD });
    expect(asOther.status).toBe(200);
    expect(asOther.body.mfaRequired).toBe(true);
    expect(asOther.body.accessToken).toBeUndefined();
    expect(asOther.body.mfaToken).toBeTruthy();

    const finished = await agent.post("/auth/mfa/verify").set(CSRF).send({ mfaToken: asOther.body.mfaToken, code: codeAt(otherSecret, 1), trustDevice: false });
    expect(finished.status).toBe(200);

    const [ownerDevice] = await db.select().from(trustedDevices).where(eq(trustedDevices.userId, owner.id));
    expect(ownerDevice!.revokedAt).toBeNull();
    expect(ownerDevice!.lastUsedAt).toBeNull();
  });

  it("changing the password revokes trusted devices", async () => {
    const user = await makeUser("reset");
    const secret = await enroll(user.email);
    const agent = request.agent(app);

    const challenge = await agent.post("/auth/login").send({ email: user.email, password: PASSWORD });
    expect((await agent.post("/auth/mfa/verify").send({ mfaToken: challenge.body.mfaToken, code: codeAt(secret, 1), trustDevice: true })).status).toBe(200);

    const token = "trusted-reset-token";
    await db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect((await request(app).post("/auth/reset-password").send({ token, newPassword: NEW_PASSWORD })).status).toBe(200);

    const [revoked] = await db.select().from(trustedDevices).where(eq(trustedDevices.userId, user.id));
    expect(revoked!.revokedAt).toBeTruthy();
    expect(await actionsFor(user.id)).toContain("trusted_devices_revoked");

    const again = await agent.post("/auth/login").set(CSRF).send({ email: user.email, password: NEW_PASSWORD });
    expect(again.status).toBe(200);
    expect(again.body.mfaRequired).toBe(true);
    expect(again.body.accessToken).toBeUndefined();
  });

  it("turning MFA off, and an admin reset, both revoke trusted devices", async () => {
    const admin = await makeUser("admin");
    await db.update(users).set({ roleId: adminRoleId }).where(eq(users.id, admin.id));
    const adminToken = signAccessToken({ sub: String(admin.id), roleId: adminRoleId, roleName: "admin", department: null, tv: 0 });

    const disabled = await makeUser("disabled");
    const disabledSecret = await enroll(disabled.email);
    const disabledAgent = request.agent(app);
    const disabledChallenge = await disabledAgent.post("/auth/login").send({ email: disabled.email, password: PASSWORD });
    const disabledSession = await disabledAgent.post("/auth/mfa/verify").send({ mfaToken: disabledChallenge.body.mfaToken, code: codeAt(disabledSecret, 1), trustDevice: true });
    expect(disabledSession.status).toBe(200);
    // The code used to trust the device consumed the newest step in the window. Rewind the replay marker so a current code can turn MFA off.
    await db.update(users).set({ mfaLastUsedStep: totpCounter() - 5 }).where(eq(users.id, disabled.id));
    expect((await disabledAgent.post("/auth/mfa/disable").set(bearer(disabledSession.body.accessToken)).send({ password: PASSWORD, code: codeAt(disabledSecret) })).status).toBe(204);
    const [disabledDevice] = await db.select().from(trustedDevices).where(eq(trustedDevices.userId, disabled.id));
    expect(disabledDevice!.revokedAt).toBeTruthy();

    const resetTarget = await makeUser("admin-reset");
    const resetSecret = await enroll(resetTarget.email);
    const resetAgent = request.agent(app);
    const resetChallenge = await resetAgent.post("/auth/login").send({ email: resetTarget.email, password: PASSWORD });
    expect((await resetAgent.post("/auth/mfa/verify").send({ mfaToken: resetChallenge.body.mfaToken, code: codeAt(resetSecret, 1), trustDevice: true })).status).toBe(200);
    expect((await request(app).post(`/users/${resetTarget.id}/mfa/reset`).set(bearer(adminToken))).status).toBe(204);

    const [resetDevice] = await db.select().from(trustedDevices).where(eq(trustedDevices.userId, resetTarget.id));
    expect(resetDevice!.revokedAt).toBeTruthy();

    const afterReset = await resetAgent.post("/auth/login").set(CSRF).send({ email: resetTarget.email, password: PASSWORD });
    expect(afterReset.body.accessToken).toBeTruthy();
    const setup = await resetAgent.post("/auth/mfa/setup").set(bearer(afterReset.body.accessToken));
    const secret = setup.body.secret as string;
    expect((await resetAgent.post("/auth/mfa/enable").set(bearer(afterReset.body.accessToken)).send({ code: codeAt(secret) })).status).toBe(200);

    const needsCode = await resetAgent.post("/auth/login").set(CSRF).send({ email: resetTarget.email, password: PASSWORD });
    expect(needsCode.body.mfaRequired).toBe(true);
    expect(needsCode.body.accessToken).toBeUndefined();
  });
});
