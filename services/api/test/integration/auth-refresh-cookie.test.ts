// Real-DB integration test (see tenant-isolation.test.ts's header comment).
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
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { refreshTokens } from "../../src/drizzle/schema/refreshTokens.js";

const app = createApp();
const suffix = Date.now();
const PASSWORD = "correct horse battery staple";
// Security-audit finding (medium): /auth/refresh now requires this header
// (see middleware/csrf.ts) — every real call in this file sends it, same
// as the real frontend (api/client.ts) does.
const CSRF = { "X-AccuQual-Csrf": "1" };

let tenantId: number;
let userId: number;
const email = `auth-refresh-cookie-${suffix}@test.local`;

describe("Auth refresh token cookie (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `Auth Cookie Test Tenant ${suffix}`, code: `auth-cookie-${suffix}` }).returning();
    tenantId = tenant!.id;

    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const [user] = await db.insert(users).values({ tenantId, email, passwordHash }).returning();
    userId = user!.id;
  });

  afterAll(async () => {
    // Real login/refresh calls now write a real refresh_tokens row each
    // time (security-audit finding: rotation/reuse tracking) — must clear
    // those before the user row they FK to.
    await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
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
  });

  it("POST /auth/refresh with the real cookie mints a fresh access token, still with no refreshToken field", async () => {
    const agent = request.agent(app);
    await agent.post("/auth/login").send({ email, password: PASSWORD });

    const res = await agent.post("/auth/refresh").set(CSRF).send({});
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeUndefined();
  });

  it("POST /auth/refresh also returns the real tenant, matching login's own shape — a browser whose persisted user/tenant is missing (cleared storage, a new device) couldn't otherwise recover a tenant-scoped session from the cookie alone", async () => {
    const agent = request.agent(app);
    await agent.post("/auth/login").send({ email, password: PASSWORD });

    const res = await agent.post("/auth/refresh").set(CSRF).send({});
    expect(res.status).toBe(200);
    expect(res.body.user?.id).toBe(userId);
    expect(res.body.tenant).toMatchObject({ id: tenantId, code: `auth-cookie-${suffix}` });
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

  it("a refresh token can only be redeemed once — replaying the SAME cookie after it rotated is rejected", async () => {
    const agent = request.agent(app);
    const loginRes = await agent.post("/auth/login").send({ email, password: PASSWORD });
    const firstRt = rtCookieFrom(loginRes);

    const firstRefresh = await agent.post("/auth/refresh").set(CSRF).send({});
    expect(firstRefresh.status).toBe(200); // rotates the agent's own cookie forward

    // Replay the ORIGINAL (now-superseded) refresh token by hand.
    const replay = await request(app).post("/auth/refresh").set(CSRF).set("Cookie", firstRt);
    expect(replay.status).toBe(401);
  });

  it("reuse of an already-rotated token revokes the whole session, not just that one token", async () => {
    const agent = request.agent(app);
    const loginRes = await agent.post("/auth/login").send({ email, password: PASSWORD });
    const firstRt = rtCookieFrom(loginRes);

    await agent.post("/auth/refresh").set(CSRF).send({}); // rotates once — firstRt is now stale
    await request(app).post("/auth/refresh").set(CSRF).set("Cookie", firstRt); // reuse — triggers revocation

    // The agent's own freshly-rotated (legitimate) cookie must now be dead too.
    const res = await agent.post("/auth/refresh").set(CSRF).send({});
    expect(res.status).toBe(401);
  });
});
