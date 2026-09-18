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

const app = createApp();
const suffix = Date.now();
const PASSWORD = "correct horse battery staple";

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

    const res = await agent.post("/auth/refresh").send({});
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeUndefined();
  });

  it("POST /auth/refresh also returns the real tenant, matching login's own shape — a browser whose persisted user/tenant is missing (cleared storage, a new device) couldn't otherwise recover a tenant-scoped session from the cookie alone", async () => {
    const agent = request.agent(app);
    await agent.post("/auth/login").send({ email, password: PASSWORD });

    const res = await agent.post("/auth/refresh").send({});
    expect(res.status).toBe(200);
    expect(res.body.user?.id).toBe(userId);
    expect(res.body.tenant).toMatchObject({ id: tenantId, code: `auth-cookie-${suffix}` });
  });

  it("POST /auth/refresh with no cookie at all is rejected — the old body-based refreshToken is no longer accepted either", async () => {
    const res = await request(app).post("/auth/refresh").send({ refreshToken: "whatever" });
    expect(res.status).toBe(401);
  });

  it("logout clears the refresh cookie — a subsequent refresh attempt on the same client fails", async () => {
    const agent = request.agent(app);
    const loginRes = await agent.post("/auth/login").send({ email, password: PASSWORD });
    const accessToken = loginRes.body.accessToken as string;

    const logoutRes = await agent.post("/auth/logout").set("Authorization", `Bearer ${accessToken}`);
    expect(logoutRes.status).toBe(204);

    const refreshRes = await agent.post("/auth/refresh").send({});
    expect(refreshRes.status).toBe(401);
  });
});
