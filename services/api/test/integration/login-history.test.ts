import { ensureTestCompany } from "../helpers/company.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { loginEvents } from "../../src/drizzle/schema/loginEvents.js";
import { signAccessToken, signRefreshToken } from "../../src/utils/jwt.js";
import { encryptRefreshCookie, REFRESH_COOKIE_NAME } from "../../src/modules/auth/refreshCookie.js";

const app = createApp();
const suffix = Date.now();
const PASSWORD = "violet-lantern-quarry-88";
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const CSRF = { "X-AccuQual-Csrf": "1" };

let companyId: number;
let adminToken: string;
let operatorToken: string;

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function makeUser(label: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const email = `history-${label}-${suffix}@test.local`;
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: await bcrypt.hash(PASSWORD, 4), name: label, ...extra })
    .returning();
  return user!;
}

describe("login history", () => {
  beforeAll(async () => {
    const company = await ensureTestCompany();
    companyId = company!.id;
    const admin = await makeUser("Admin");
    const operator = await makeUser("Operator");
    adminToken = signAccessToken({ sub: String(admin.id), roleId: null, roleName: "admin", department: null });
    operatorToken = signAccessToken({ sub: String(operator.id), roleId: null, roleName: "operator", department: null });
  });

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await pool.end();
  });

  it("records a successful password sign-in with the trusted-proxy address and the device", async () => {
    const user = await makeUser("SignedIn");
    const res = await request(app)
      .post("/auth/login")
      .set("User-Agent", CHROME)
      .set("Sec-CH-UA-Platform-Version", "15.0.0")
      .set("X-Forwarded-For", "198.51.100.9, 203.0.113.44")
      .send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD);

    const rows = await db.select().from(loginEvents).where(eq(loginEvents.email, user.email));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: user.id,
      companyId,
      eventType: "signed_in",
      success: true,
      reason: "Password",
      method: "password",
      ipAddress: "203.0.113.44",
      browser: "Chrome",
      browserVersion: "129",
      os: "Windows 11",
      deviceType: "desktop",
      userAgent: CHROME,
    });
    expect(JSON.stringify(rows[0])).not.toContain(PASSWORD);
    expect(rows[0]!.occurredAt).toBeInstanceOf(Date);

    const cookie = (res.headers["set-cookie"] as unknown as string[]).find((header) => header.startsWith(`${REFRESH_COOKIE_NAME}=`));
    expect(cookie).toBeTruthy();
    const renewed = await request(app).post("/auth/refresh").set("Cookie", cookie!.split(";")[0]!).set(CSRF);
    expect(renewed.status).toBe(200);
    const afterRefresh = await db.select().from(loginEvents).where(eq(loginEvents.email, user.email));
    expect(afterRefresh).toHaveLength(1);

    const legacy = signRefreshToken({ sub: String(user.id), tokenVersion: user.tokenVersion });
    const started = await request(app)
      .post("/auth/refresh")
      .set("Cookie", `${REFRESH_COOKIE_NAME}=${encryptRefreshCookie(legacy)}`)
      .set(CSRF)
      .set("User-Agent", CHROME);
    expect(started.status).toBe(200);
    const afterLegacy = await db.select().from(loginEvents).where(eq(loginEvents.userId, user.id));
    const freshSessions = afterLegacy.filter((row) => row.method === "session_refresh");
    expect(freshSessions).toHaveLength(1);
    expect(freshSessions[0]).toMatchObject({ eventType: "signed_in", success: true, reason: "New session" });
  });

  it("records wrong password, an unknown account, a disabled account, a locked account, and sign-out", async () => {
    const user = await makeUser("Failures");
    const wrong = await request(app).post("/auth/login").set("X-Forwarded-For", "203.0.113.10").send({ email: user.email, password: "not-the-password" });
    expect(wrong.status).toBe(401);
    const [wrongRow] = await db.select().from(loginEvents).where(eq(loginEvents.email, user.email));
    expect(wrongRow).toMatchObject({ eventType: "sign_in_failed", success: false, reason: "Wrong password", ipAddress: "203.0.113.10", userId: user.id });
    expect(JSON.stringify(wrongRow)).not.toContain("not-the-password");

    const unknownEmail = `missing-${suffix}@test.local`;
    const unknown = await request(app).post("/auth/login").send({ email: unknownEmail, password: PASSWORD });
    expect(unknown.status).toBe(401);
    const [unknownRow] = await db.select().from(loginEvents).where(eq(loginEvents.email, unknownEmail));
    expect(unknownRow).toMatchObject({ userId: null, eventType: "sign_in_failed", reason: "Unknown account", success: false });

    const disabled = await makeUser("Disabled", { isActive: false });
    const disabledRes = await request(app).post("/auth/login").send({ email: disabled.email, password: PASSWORD });
    expect(disabledRes.status).toBe(403);
    const [disabledRow] = await db.select().from(loginEvents).where(eq(loginEvents.email, disabled.email));
    expect(disabledRow).toMatchObject({ reason: "Account disabled", success: false, eventType: "sign_in_failed" });

    const locked = await makeUser("Locked", { lockedUntil: new Date(Date.now() + 10 * 60_000) });
    const lockedRes = await request(app).post("/auth/login").send({ email: locked.email, password: PASSWORD });
    expect(lockedRes.status).toBe(429);
    const [lockedRow] = await db.select().from(loginEvents).where(eq(loginEvents.email, locked.email));
    expect(lockedRow).toMatchObject({ reason: "Account locked", success: false });

    const signedIn = await request(app).post("/auth/login").send({ email: user.email, password: PASSWORD });
    expect(signedIn.status).toBe(200);
    const bye = await request(app).post("/auth/logout").set(auth(signedIn.body.accessToken as string));
    expect(bye.status).toBe(204);
    const events = await db.select().from(loginEvents).where(eq(loginEvents.userId, user.id));
    expect(events.map((row) => row.eventType)).toEqual(expect.arrayContaining(["sign_in_failed", "signed_in", "signed_out"]));
    expect(events.find((row) => row.eventType === "signed_out")).toMatchObject({ success: true, reason: "Signed out" });
  });

  it("refuses a role that has not been allowed to see login history", async () => {
    const denied = await request(app).get("/login-history").set(auth(operatorToken));
    expect(denied.status).toBe(403);

    const [adminRole] = await db.select().from(roles).where(eq(roles.name, "admin"));
    const original = adminRole!.permissions ?? [];
    await db.update(roles).set({ permissions: original.filter((permission) => permission !== "login_history") }).where(eq(roles.name, "admin"));
    try {
      const stripped = await request(app).get("/login-history").set(auth(adminToken));
      expect(stripped.status).toBe(403);
    } finally {
      await db.update(roles).set({ permissions: original }).where(eq(roles.name, "admin"));
    }

    const roleName = `historian-${suffix}`;
    await db.insert(roles).values({ name: roleName, description: "Sees sign-ins", hierarchyLevel: 70, isProtected: false, permissions: ["login_history"] });
    const clerk = await makeUser("Clerk");
    const token = signAccessToken({ sub: String(clerk.id), roleId: null, roleName, department: null });
    const allowed = await request(app).get("/login-history").set(auth(token));
    expect(allowed.status).toBe(200);
    expect(allowed.body.items).toEqual(expect.any(Array));
    for (const item of allowed.body.items as Record<string, unknown>[]) {
      expect(item).not.toHaveProperty("id");
    }
  });

  it("shows only this company's rows, newest first, and exports them without record numbers", async () => {
    const insideEmail = `inside-${suffix}@test.local`;
    await db.insert(loginEvents).values([
      {
        companyId,
        email: insideEmail,
        userName: "Inside Person",
        eventType: "signed_in",
        success: true,
        reason: "Password",
        ipAddress: "203.0.113.20",
        locationCity: "Seattle",
        locationRegion: "Washington",
        locationCountry: "United States",
        browser: "Chrome",
        browserVersion: "129",
        os: "Windows 11",
        deviceType: "desktop",
        occurredAt: new Date("2026-03-01T15:00:00.000Z"),
      },
      {
        companyId,
        email: insideEmail,
        userName: "Inside Person",
        eventType: "sign_in_failed",
        success: false,
        reason: "Wrong password",
        occurredAt: new Date("2026-03-02T15:00:00.000Z"),
      },
      {
        companyId: companyId + 100_000,
        email: `outside-${suffix}@test.local`,
        userName: "Outside Person",
        eventType: "signed_in",
        success: true,
        reason: "Password",
        occurredAt: new Date("2026-03-03T15:00:00.000Z"),
      },
    ]);

    const listed = await request(app).get("/login-history").query({ user: "Inside Person", pageSize: 1, page: 1 }).set(auth(adminToken));
    expect(listed.status).toBe(200);
    expect(listed.body.total).toBe(2);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0].email).toBe(insideEmail);
    expect(listed.body.items[0].event).toBe("sign_in_failed");
    expect(listed.body.items[0].location).toBe("");
    expect(listed.body.items[0]).not.toHaveProperty("id");
    expect(JSON.stringify(listed.body)).not.toContain(`outside-${suffix}`);

    const page2 = await request(app).get("/login-history").query({ user: insideEmail, pageSize: 1, page: 2 }).set(auth(adminToken));
    expect(page2.body.items[0].event).toBe("signed_in");
    expect(page2.body.items[0].location).toBe("Seattle, Washington, United States");
    expect(page2.body.items[0].device).toBe("Chrome 129 on Windows 11, Desktop");

    const failedOnly = await request(app).get("/login-history").query({ user: insideEmail, success: "false", event: "sign_in_failed" }).set(auth(adminToken));
    expect(failedOnly.body.total).toBe(1);
    expect(failedOnly.body.items[0].reason).toBe("Wrong password");

    const csv = await request(app).get("/login-history/export").query({ user: "Inside" }).set(auth(adminToken));
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    const text = csv.text.replace(/^\uFEFF/, "");
    const header = text.split("\r\n")[0];
    expect(header).toBe("Date/Time (UTC),User,Email,Event,Result,Reason,IP address,Location,Device,User agent");
    expect(header!.split(",")).not.toContain("id");
    expect(text).toContain(insideEmail);
    expect(text).toContain("Sign-in failed");
    expect(text).not.toContain(`outside-${suffix}`);
    expect(text).not.toContain(PASSWORD);
  });

  it("keeps sign-in working and returns an empty page when the history table is not there yet", async () => {
    await db.execute(sql`ALTER TABLE login_events RENAME TO login_events_hidden`);
    try {
      const user = await makeUser("BeforeMigrate");
      const signedIn = await request(app).post("/auth/login").send({ email: user.email, password: PASSWORD });
      expect(signedIn.status).toBe(200);
      const listed = await request(app).get("/login-history").set(auth(adminToken));
      expect(listed.status).toBe(200);
      expect(listed.body).toMatchObject({ items: [], total: 0, unavailable: true });
    } finally {
      await db.execute(sql`ALTER TABLE login_events_hidden RENAME TO login_events`);
    }
  });
});
