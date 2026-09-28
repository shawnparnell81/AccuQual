import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Regression coverage for Full-System Audit finding B2: the refresh token
// used to be a plain field in the login/register/refresh JSON response,
// which the frontend then had nowhere safe to keep except localStorage —
// readable by any script on the page, exactly what an XSS bug goes looking
// for. It now travels only as an httpOnly cookie the response body never
// includes and frontend JS can never read.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { refreshTokens } from "../../src/drizzle/schema/refreshTokens.js";
import { REFRESH_REUSE_GRACE_MS } from "../../src/modules/auth/auth.service.js";
import { decryptRefreshCookie } from "../../src/modules/auth/refreshCookie.js";

const app = createApp();
const suffix = Date.now();
const PASSWORD = "correct horse battery staple";
// Security-audit finding (medium): /auth/refresh now requires this header
// (see middleware/csrf.ts) — every real call in this file sends it, same
// as the real frontend (api/client.ts) does.
const CSRF = { "X-AccuQual-Csrf": "1" };

let companyId: number;
let userId: number;
const email = `auth-refresh-cookie-${suffix}@test.local`;

describe("Auth refresh token cookie (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;

    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const [user] = await db.insert(users).values({ email, passwordHash }).returning();
    userId = user!.id;
  });

  afterAll(async () => {
    // Real login/refresh calls now write a real refresh_tokens row each
    // time (security-audit finding: rotation/reuse tracking) — must clear
    // those before the user row they FK to.
    await pool.end();
  });

  it("login sets an httpOnly refresh cookie and never puts the refresh token in the response body", async () => {
    const res = await request(app).post("/auth/login").send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeUndefined();

    const setCookie = res.headers["set-cookie"] as unknown as string[];
    expect(setCookie).toBeTruthy();
    const rtCookie = setCookie.find((c) => c.startsWith("accuqual_rt="));
    expect(rtCookie).toBeTruthy();
    expect(rtCookie!.toLowerCase()).toContain("httponly");
    // Path=/ , not a narrower "/auth" — see setRefreshCookie's own comment:
    // this repo's docker-compose nginx proxy strips a "/api" prefix before
    // it ever reaches this service, so the browser's view of this same
    // request is "/api/auth/login", which a Path=/auth cookie would never
    // match on the next call.
    expect(rtCookie!.toLowerCase()).toContain("path=/;");
    // Host-only: the browser calls app.accuqualqms.com and the /api rewrite
    // reaches the API. A Domain attribute for the API host would hide the cookie.
    expect(rtCookie!.toLowerCase()).not.toContain("domain=");
    expectBrowserSessionCookie(rtCookie);
    const csrf = setCookie.find((c) => c.startsWith("accuqual_csrf="));
    expectBrowserSessionCookie(csrf);
  });

  /** Attributes only, so a value that happens to contain the words cannot satisfy the check. */
  function cookieAttributes(header: string): string {
    const semi = header.indexOf(";");
    expect(semi).toBeGreaterThan(0);
    return header.slice(semi).toLowerCase();
  }

  /** No Max-Age and no Expires: the browser drops the cookie when it closes. */
  function expectBrowserSessionCookie(header: string | undefined) {
    expect(header).toBeTruthy();
    const attrs = cookieAttributes(header!);
    expect(attrs).not.toMatch(/max-age=/);
    expect(attrs).not.toMatch(/expires=/);
  }

  it("keeps the 12-hour limit on the server, and the browser cookie ends when the browser closes", async () => {
    const rtCookieOf = (res: request.Response) => (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("accuqual_rt="))!;
    const twelveHours = 12 * 60 * 60 * 1000;

    const plain = await request(app).post("/auth/login").send({ email, password: PASSWORD });
    expectBrowserSessionCookie(rtCookieOf(plain));
    const plainJti = jtiFromCookie(rtCookieFrom(plain));
    const [plainRow] = await db.select().from(refreshTokens).where(eq(refreshTokens.jti, plainJti));
    const plainRemaining = plainRow!.expiresAt.getTime() - Date.now();
    expect(plainRemaining).toBeGreaterThan(twelveHours - 5_000);
    expect(plainRemaining).toBeLessThanOrEqual(twelveHours);

    const agent = request.agent(app);
    const remembered = await agent.post("/auth/login").send({ email, password: PASSWORD, rememberMe: true });
    expect(remembered.status).toBe(200);
    expect(remembered.body.remember).toBeUndefined();
    expect(remembered.body.sessionExpiresAt).toBeUndefined();
    expectBrowserSessionCookie(rtCookieOf(remembered));
    expect(cookieAttributes(rtCookieOf(remembered))).not.toContain("max-age=2592000");

    const originalJti = jtiFromCookie(rtCookieFrom(remembered));
    const [original] = await db.select().from(refreshTokens).where(eq(refreshTokens.jti, originalJti));
    const rememberedRemaining = original!.expiresAt.getTime() - Date.now();
    expect(rememberedRemaining).toBeGreaterThan(twelveHours - 5_000);
    expect(rememberedRemaining).toBeLessThanOrEqual(twelveHours);

    const refreshed = await agent.post("/auth/refresh").set(CSRF).send({});
    expect(refreshed.status).toBe(200);
    expectBrowserSessionCookie(rtCookieOf(refreshed));
    expect(cookieAttributes(rtCookieOf(refreshed))).not.toContain("max-age=2592000");

    const rotatedJti = jtiFromCookie(rtCookieFrom(refreshed));
    const [rotated] = await db.select().from(refreshTokens).where(eq(refreshTokens.jti, rotatedJti));
    expect(rotated!.expiresAt.getTime()).toBe(original!.expiresAt.getTime());
  });

  it("pulls an older long-lived session back to 12 hours and does not slide it on the next refresh", async () => {
    const agent = request.agent(app);
    const loginRes = await agent.post("/auth/login").send({ email, password: PASSWORD });
    const firstJti = jtiFromCookie(rtCookieFrom(loginRes));
    const far = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.update(refreshTokens).set({ expiresAt: far }).where(eq(refreshTokens.jti, firstJti));

    const first = await agent.post("/auth/refresh").set(CSRF).send({});
    expect(first.status).toBe(200);
    const clampedJti = jtiFromCookie(rtCookieFrom(first));
    const [clamped] = await db.select().from(refreshTokens).where(eq(refreshTokens.jti, clampedJti));
    const remaining = clamped!.expiresAt.getTime() - Date.now();
    expect(remaining).toBeLessThanOrEqual(12 * 60 * 60 * 1000);
    expect(remaining).toBeGreaterThan(12 * 60 * 60 * 1000 - 5_000);
    expect(clamped!.expiresAt.getTime()).toBeLessThan(far.getTime());

    const second = await agent.post("/auth/refresh").set(CSRF).send({});
    expect(second.status).toBe(200);
    const nextJti = jtiFromCookie(rtCookieFrom(second));
    const [next] = await db.select().from(refreshTokens).where(eq(refreshTokens.jti, nextJti));
    expect(next!.expiresAt.getTime()).toBe(clamped!.expiresAt.getTime());
  });

  it("POST /auth/refresh with the real cookie mints a fresh access token, still with no refreshToken field", async () => {
    const agent = request.agent(app);
    await agent.post("/auth/login").send({ email, password: PASSWORD });

    const res = await agent.post("/auth/refresh").set(CSRF).send({});
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeUndefined();
  });

  it("POST /auth/refresh also returns the real company, matching login's own shape — a browser whose persisted user/company is missing (cleared storage, a new device) couldn't otherwise recover a session from the cookie alone", async () => {
    const agent = request.agent(app);
    await agent.post("/auth/login").send({ email, password: PASSWORD });

    const res = await agent.post("/auth/refresh").set(CSRF).send({});
    expect(res.status).toBe(200);
    expect(res.body.user?.id).toBe(userId);
    expect(res.body.company).toMatchObject({ id: companyId });
  });

  it("POST /auth/refresh with no cookie at all is rejected — the old body-based refreshToken is no longer accepted either", async () => {
    const res = await request(app).post("/auth/refresh").set(CSRF).send({ refreshToken: "whatever" });
    expect(res.status).toBe(401);
  });

  it("POST /auth/refresh with a valid cookie but no anti-CSRF header is rejected outright", async () => {
    const agent = request.agent(app);
    await agent.post("/auth/login").send({ email, password: PASSWORD });
    const res = await agent.post("/auth/refresh").send({}); // deliberately no CSRF header
    expect(res.status).toBe(403);
  });

  it("ending a restored browser session revokes only that browser and leaves the trusted-browser cookie alone", async () => {
    const first = request.agent(app);
    const second = request.agent(app);
    const a = await first.post("/auth/login").send({ email, password: PASSWORD });
    const b = await second.post("/auth/login").send({ email, password: PASSWORD });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const saved = rtCookieFrom(a);
    const [before] = await db.select({ tokenVersion: users.tokenVersion }).from(users).where(eq(users.id, userId));

    const ended = await first.post("/auth/end-browser-session").set(CSRF).send({});
    expect(ended.status).toBe(204);
    const cleared = ended.headers["set-cookie"] as unknown as string[];
    expect(cleared.some((header) => header.startsWith("accuqual_rt="))).toBe(true);
    expect(cleared.some((header) => header.startsWith("accuqual_csrf="))).toBe(true);
    expect(cleared.some((header) => header.startsWith("accuqual_td="))).toBe(false);

    expect((await first.post("/auth/refresh").set(CSRF).send({})).status).toBe(401);
    expect((await request(app).post("/auth/refresh").set(CSRF).set("Cookie", saved)).status).toBe(401);
    expect((await second.post("/auth/refresh").set(CSRF).send({})).status).toBe(200);

    const [after] = await db.select({ tokenVersion: users.tokenVersion }).from(users).where(eq(users.id, userId));
    expect(after!.tokenVersion).toBe(before!.tokenVersion);
  });

  it("refuses to end a browser session without the anti-CSRF header, and does nothing when there is no sign-in cookie", async () => {
    const agent = request.agent(app);
    await agent.post("/auth/login").send({ email, password: PASSWORD });
    expect((await agent.post("/auth/end-browser-session").send({})).status).toBe(403);
    expect((await agent.post("/auth/refresh").set(CSRF).send({})).status).toBe(200);

    const empty = await request(app).post("/auth/end-browser-session").set(CSRF).send({});
    expect(empty.status).toBe(204);
  });

  it("logout clears the refresh cookie — a subsequent refresh attempt on the same client fails", async () => {
    const agent = request.agent(app);
    const loginRes = await agent.post("/auth/login").send({ email, password: PASSWORD });
    const accessToken = loginRes.body.accessToken as string;

    const logoutRes = await agent.post("/auth/logout").set("Authorization", `Bearer ${accessToken}`);
    expect(logoutRes.status).toBe(204);

    const refreshRes = await agent.post("/auth/refresh").set(CSRF).send({});
    expect(refreshRes.status).toBe(401);
  });

  // Security-audit finding (medium): refresh tokens previously had no
  // rotation or reuse detection — a captured refresh token stayed valid
  // for its full TTL with no way to notice it being replayed.
  function rtCookieFrom(res: request.Response): string {
    const setCookie = res.headers["set-cookie"] as unknown as string[];
    const raw = setCookie.find((c) => c.startsWith("accuqual_rt="))!;
    return raw.split(";")[0]!; // "accuqual_rt=<value>", stripping the cookie's own attributes
  }

  function jtiFromCookie(cookie: string): string {
    const raw = decodeURIComponent(cookie.slice("accuqual_rt=".length));
    const token = decryptRefreshCookie(raw);
    if (!token) throw new Error("refresh cookie was not encrypted");
    const payload = token.split(".")[1]!;
    return (JSON.parse(Buffer.from(payload, "base64url").toString()) as { jti: string }).jti;
  }

  it("overlapping renewals of the same cookie all succeed and leave the session usable", async () => {
    const loginRes = await request(app).post("/auth/login").send({ email, password: PASSWORD });
    const firstRt = rtCookieFrom(loginRes);

    const burst = await Promise.all([
      request(app).post("/auth/refresh").set(CSRF).set("Cookie", firstRt),
      request(app).post("/auth/refresh").set(CSRF).set("Cookie", firstRt),
      request(app).post("/auth/refresh").set(CSRF).set("Cookie", firstRt),
    ]);
    for (const res of burst) expect(res.status).toBe(200);

    // One of the cookies issued by that burst must still renew — the overlap
    // must not have revoked the whole session.
    const again = await request(app).post("/auth/refresh").set(CSRF).set("Cookie", rtCookieFrom(burst[0]!));
    expect(again.status).toBe(200);
  });

  it("replaying the previous token after the grace window revokes the whole session", async () => {
    const agent = request.agent(app);
    const loginRes = await agent.post("/auth/login").send({ email, password: PASSWORD });
    const firstRt = rtCookieFrom(loginRes);

    const rotated = await agent.post("/auth/refresh").set(CSRF).send({});
    expect(rotated.status).toBe(200);

    await db
      .update(refreshTokens)
      .set({ usedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 5_000) })
      .where(eq(refreshTokens.jti, jtiFromCookie(firstRt)));

    const replay = await request(app).post("/auth/refresh").set(CSRF).set("Cookie", firstRt);
    expect(replay.status).toBe(401);

    // The agent's own freshly-rotated (legitimate) cookie must now be dead too.
    const res = await agent.post("/auth/refresh").set(CSRF).send({});
    expect(res.status).toBe(401);
  });

  it("replaying a token the session has already moved past revokes the session even inside the grace window", async () => {
    const agent = request.agent(app);
    const loginRes = await agent.post("/auth/login").send({ email, password: PASSWORD });
    const firstRt = rtCookieFrom(loginRes);

    expect((await agent.post("/auth/refresh").set(CSRF).send({})).status).toBe(200);
    expect((await agent.post("/auth/refresh").set(CSRF).send({})).status).toBe(200);

    const replay = await request(app).post("/auth/refresh").set(CSRF).set("Cookie", firstRt);
    expect(replay.status).toBe(401);

    const res = await agent.post("/auth/refresh").set(CSRF).send({});
    expect(res.status).toBe(401);
  });
});
