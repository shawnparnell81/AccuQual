// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// OpenID Connect single sign-on, end to end against a small in-process identity
// provider (discovery document, JWKS, signed ID tokens, PKCE-checking token
// endpoint) so the real `openid-client` validation runs. DNS is the one thing
// stubbed: domain verification reads TXT records through dnsVerify.ts.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { eq, inArray } from "drizzle-orm";

const dns = vi.hoisted(() => ({ records: new Map<string, string[]>() }));
vi.mock("../../src/modules/sso/dnsVerify.js", () => ({
  VERIFY_RECORD_PREFIX: "_accuqual-verify",
  lookupTxt: async (name: string) => dns.records.get(name) ?? [],
}));

import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { refreshTokens } from "../../src/drizzle/schema/refreshTokens.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { auditRowChanges } from "../../src/drizzle/schema/auditRowChanges.js";
import { ssoConnections, ssoDomains, userIdentities } from "../../src/drizzle/schema/sso.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();
const CSRF = { "X-AccuQual-Csrf": "1" };
const CLIENT_ID = "accuqual-test-client";
const CLIENT_SECRET = "super-secret-client-value";
const DOMAIN = `sso-${suffix}.example`;
const PASSWORD = "violet-lantern-quarry-88";

// ---- A minimal OpenID provider ---------------------------------------------------------------------------------------------------------------

interface Pending {
  nonce: string;
  challenge: string;
  redirectUri: string;
  claims: Record<string, unknown>;
  aud: string;
  expired: boolean;
}

class FakeIdp {
  server = http.createServer((req, res) => void this.handle(req, res));
  issuer = "";
  pending = new Map<string, Pending>();
  private key!: Awaited<ReturnType<typeof generateKeyPair>>;
  private jwk!: Record<string, unknown>;

  async start() {
    this.key = await generateKeyPair("RS256");
    this.jwk = { ...(await exportJWK(this.key.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    this.issuer = `http://127.0.0.1:${(this.server.address() as { port: number }).port}`;
  }
  stop() {
    this.server.close();
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? "/", this.issuer);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/.well-known/openid-configuration") {
      return json(200, {
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/authorize`,
        token_endpoint: `${this.issuer}/token`,
        jwks_uri: `${this.issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url.pathname === "/jwks") return json(200, { keys: [this.jwk] });
    if (url.pathname === "/token" && req.method === "POST") {
      const body = await new Promise<string>((r) => {
        let d = "";
        req.on("data", (c) => (d += c));
        req.on("end", () => r(d));
      });
      const form = new URLSearchParams(body);
      const pending = this.pending.get(form.get("code") ?? "");
      if (!pending) return json(400, { error: "invalid_grant" });
      this.pending.delete(form.get("code")!); // a code works once
      const verifier = form.get("code_verifier") ?? "";
      if (createHash("sha256").update(verifier).digest("base64url") !== pending.challenge) return json(400, { error: "invalid_grant", error_description: "PKCE mismatch" });
      if (form.get("redirect_uri") !== pending.redirectUri) return json(400, { error: "invalid_grant" });
      const now = Math.floor(Date.now() / 1000);
      const idToken = await new SignJWT({ nonce: pending.nonce, ...pending.claims })
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(this.issuer)
        .setAudience(pending.aud)
        .setIssuedAt(pending.expired ? now - 7200 : now)
        .setExpirationTime(pending.expired ? now - 3600 : now + 300)
        .sign(this.key.privateKey);
      return json(200, { access_token: "at", token_type: "Bearer", expires_in: 300, id_token: idToken });
    }
    json(404, {});
  }

  /** What the browser would do after the user signs in at the provider: turns the authorize URL into the callback path. */
  authorize(authorizeUrl: string, claims: Record<string, unknown>, opts: { aud?: string; expired?: boolean; state?: string } = {}) {
    const u = new URL(authorizeUrl);
    expect(u.origin).toBe(this.issuer);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    const code = randomBytes(12).toString("hex");
    this.pending.set(code, {
      nonce: u.searchParams.get("nonce")!,
      challenge: u.searchParams.get("code_challenge")!,
      redirectUri: u.searchParams.get("redirect_uri")!,
      claims,
      aud: opts.aud ?? CLIENT_ID,
      expired: opts.expired ?? false,
    });
    return `/auth/sso/callback?code=${code}&state=${opts.state ?? u.searchParams.get("state")}`;
  }
}

// ---- Fixtures ---------------------------------------------------------------------------------------------------------------------------------

const idp = new FakeIdp();
let tenantId: number;
let otherTenantId: number;
let tenantCode: string;
let adminToken: string;
let workerRoleId: number;
let adminRoleId: number;
const userIds: number[] = [];
const createdRoleIds: number[] = []; // only the uniquely named worker role; 'admin' is a shared system role and is left in place (parallel test files use it)
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

async function ensureRole(name: string): Promise<number> {
  const [existing] = await db.select().from(roles).where(eq(roles.name, name));
  if (existing) return existing.id;
  const [r] = await db.insert(roles).values({ name }).onConflictDoNothing().returning();
  if (r) {
    if (name.startsWith("sso-worker-")) createdRoleIds.push(r.id);
    return r.id;
  }
  return (await db.select().from(roles).where(eq(roles.name, name)))[0]!.id;
}

async function makeUser(label: string, tenant: number, extra: Partial<typeof users.$inferInsert> = {}) {
  const email = `${label}-${suffix}@${DOMAIN}`;
  const [u] = await db.insert(users).values({ tenantId: tenant, email, passwordHash: await bcrypt.hash(PASSWORD, 4), ...extra }).returning();
  userIds.push(u!.id);
  return { id: u!.id, email };
}

/** Runs one full browser round trip: /auth/sso/start -> provider -> callback. Returns where the app sent the browser and, if a session began, the user it began for. */
async function ssoSignIn(claims: Record<string, unknown>, opts: { aud?: string; expired?: boolean; state?: string; tenant?: string } = {}) {
  const agent = request.agent(app);
  const start = await agent.get(`/auth/sso/start?tenant=${opts.tenant ?? tenantCode}`);
  if (start.status !== 302 || !String(start.headers.location).startsWith(idp.issuer)) return { start, location: String(start.headers.location ?? ""), session: null as null | { id: number; email: string } };
  const callback = await agent.get(idp.authorize(start.headers.location as string, claims, opts));
  const location = String(callback.headers.location ?? "");
  let session: { id: number; email: string } | null = null;
  const setCookie = (callback.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
  if (setCookie.some((c) => c.startsWith("accuqual_rt=") && !c.includes("accuqual_rt=;"))) {
    const refreshed = await agent.post("/auth/refresh").set(CSRF);
    if (refreshed.status === 200) session = { id: refreshed.body.user.id, email: refreshed.body.user.email };
  }
  return { start, callback, location, session };
}

const errorOf = (location: string) => new URL(location).searchParams.get("sso_error");
const claimsFor = (email: string, extra: Record<string, unknown> = {}) => ({ sub: `sub-${email}`, email, email_verified: true, name: "Test Person", ...extra });

describe("OpenID Connect single sign-on (real DB + real openid-client)", () => {
  beforeAll(async () => {
    await idp.start();
    const [t] = await db.insert(tenants).values({ name: `SSO Test ${suffix}`, code: `sso-${suffix}` }).returning();
    const [o] = await db.insert(tenants).values({ name: `SSO Other ${suffix}`, code: `sso-other-${suffix}` }).returning();
    tenantId = t!.id;
    otherTenantId = o!.id;
    tenantCode = t!.code;
    adminRoleId = await ensureRole("admin");
    workerRoleId = await ensureRole(`sso-worker-${suffix}`);
    const admin = await makeUser("sso-admin", tenantId, { roleId: adminRoleId });
    adminToken = await signAccessToken({ sub: String(admin.id), tenantId, roleId: adminRoleId, roleName: "admin", department: null });
  });

  afterAll(async () => {
    idp.stop();
    await new Promise((r) => setTimeout(r, 300));
    const tenantIds = [tenantId, otherTenantId];
    await db.delete(userIdentities).where(inArray(userIdentities.tenantId, tenantIds));
    await db.delete(ssoConnections).where(inArray(ssoConnections.tenantId, tenantIds));
    await db.delete(ssoDomains).where(inArray(ssoDomains.tenantId, tenantIds));
    for (const t of tenantIds) {
      await db.delete(auditRowChanges).where(eq(auditRowChanges.tenantId, t));
      await db.delete(auditTrail).where(eq(auditTrail.tenantId, t));
    }
    await db.delete(refreshTokens).where(inArray(refreshTokens.userId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
    if (createdRoleIds.length) await db.delete(roles).where(inArray(roles.id, createdRoleIds));
    for (const t of tenantIds) {
      await db.delete(tenants).where(eq(tenants.id, t));
      await db.delete(auditRowChanges).where(eq(auditRowChanges.tenantId, t));
    }
    await pool.end();
  });

  describe("setup by a tenant admin", () => {
    it("only admins can configure SSO", async () => {
      const worker = await makeUser("sso-nonadmin", tenantId);
      const token = await signAccessToken({ sub: String(worker.id), tenantId, roleId: null, roleName: null, department: null });
      expect((await request(app).get("/sso").set(bearer(token))).status).toBe(403);
    });

    it("free email domains cannot be verified, and a domain needs its TXT record", async () => {
      expect((await request(app).post("/sso/domains").set(bearer(adminToken)).send({ domain: "gmail.com" })).status).toBe(400);
      expect((await request(app).post("/sso/domains").set(bearer(adminToken)).send({ domain: "not a domain" })).status).toBe(400);

      const added = await request(app).post("/sso/domains").set(bearer(adminToken)).send({ domain: DOMAIN });
      expect(added.status).toBe(201);
      expect(added.body).toMatchObject({ verified: false, txtName: `_accuqual-verify.${DOMAIN}` });
      expect(added.body.txtValue).toMatch(/^accuqual-verify=[0-9a-f]{40}$/);

      const early = await request(app).post(`/sso/domains/${added.body.id}/verify`).set(bearer(adminToken));
      expect(early.status).toBe(400);
      expect(early.body.message).toMatch(/TXT record/);

      // SSO cannot be switched on before a domain is verified.
      const tooSoon = await request(app).put("/sso").set(bearer(adminToken)).send({ issuer: idp.issuer, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, enabled: true });
      expect(tooSoon.status).toBe(400);
      expect(tooSoon.body.message).toMatch(/Verify at least one/);

      dns.records.set(`_accuqual-verify.${DOMAIN}`, ["unrelated", added.body.txtValue]);
      const ok = await request(app).post(`/sso/domains/${added.body.id}/verify`).set(bearer(adminToken));
      expect(ok.status).toBe(200);
      expect(ok.body.verified).toBe(true);
    });

    it("another organization cannot verify a domain that is already taken", async () => {
      const [other] = await db.insert(ssoDomains).values({ tenantId: otherTenantId, domain: DOMAIN, verificationToken: "abc123" }).returning();
      const otherUser = await makeUser("sso-other-admin", otherTenantId, { roleId: adminRoleId });
      const otherToken = await signAccessToken({ sub: String(otherUser.id), tenantId: otherTenantId, roleId: adminRoleId, roleName: "admin", department: null });
      dns.records.set(`_accuqual-verify.${DOMAIN}`, [...(dns.records.get(`_accuqual-verify.${DOMAIN}`) ?? []), "accuqual-verify=abc123"]);
      const res = await request(app).post(`/sso/domains/${other!.id}/verify`).set(bearer(otherToken));
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/another organization/);
      await db.delete(ssoDomains).where(eq(ssoDomains.id, other!.id));
    });

    it("saves the connection with the secret encrypted and never returns it", async () => {
      const res = await request(app).put("/sso").set(bearer(adminToken)).send({ displayName: "Test IdP", issuer: idp.issuer, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, enabled: true });
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain(CLIENT_SECRET);
      expect(res.body.clientSecretEncrypted).toBeUndefined();

      const [row] = await db.select().from(ssoConnections).where(eq(ssoConnections.tenantId, tenantId));
      expect(row!.clientSecretEncrypted).not.toContain(CLIENT_SECRET);
      const got = await request(app).get("/sso").set(bearer(adminToken));
      expect(JSON.stringify(got.body)).not.toContain(CLIENT_SECRET);
      expect(got.body.redirectUri).toMatch(/\/auth\/sso\/callback$/);
      expect(got.body.domains[0]).toMatchObject({ domain: DOMAIN, verified: true });

      // The audit row-change log never sees the secret either.
      await new Promise((r) => setTimeout(r, 100));
      const changes = await db.select().from(auditRowChanges).where(eq(auditRowChanges.tableName, "sso_connections"));
      expect(JSON.stringify(changes)).not.toContain(CLIENT_SECRET);
      expect(JSON.stringify(changes)).not.toContain(row!.clientSecretEncrypted);
    });

    it("refuses an unreachable provider, an admin default role, and requiring SSO while disabled", async () => {
      const bad = await request(app).put("/sso").set(bearer(adminToken)).send({ issuer: "http://127.0.0.1:1", clientId: CLIENT_ID, enabled: true });
      expect(bad.status).toBe(400);
      const noHttps = await request(app).put("/sso").set(bearer(adminToken)).send({ issuer: "http://idp.example.com", clientId: CLIENT_ID, enabled: false });
      expect(noHttps.status).toBe(400);
      const adminRole = await request(app).put("/sso").set(bearer(adminToken)).send({ issuer: idp.issuer, clientId: CLIENT_ID, enabled: true, autoProvision: true, defaultRoleId: adminRoleId });
      expect(adminRole.status).toBe(400);
      expect(adminRole.body.message).toMatch(/administrator/);
      const enforce = await request(app).put("/sso").set(bearer(adminToken)).send({ issuer: idp.issuer, clientId: CLIENT_ID, enabled: false, enforceSso: true });
      expect(enforce.status).toBe(400);
    });

    it("tells the login page whether an organization uses SSO, and nothing else", async () => {
      expect((await request(app).get(`/auth/sso/discover?tenant=${tenantCode}`)).body).toEqual({ enabled: true, displayName: "Test IdP" });
      expect((await request(app).get("/auth/sso/discover?tenant=no-such-tenant")).body).toEqual({ enabled: false, displayName: null });
    });
  });

  describe("signing in", () => {
    it("links an existing account on its verified email, then recognizes it by the provider subject", async () => {
      const u = await makeUser("sso-existing", tenantId);
      const first = await ssoSignIn(claimsFor(u.email));
      expect(first.location).toBe("http://localhost:5183/");
      expect(first.session).toMatchObject({ id: u.id, email: u.email });
      expect(first.callback!.headers["set-cookie"]).toBeTruthy();

      const [identity] = await db.select().from(userIdentities).where(eq(userIdentities.userId, u.id));
      expect(identity!.subject).toBe(`sub-${u.email}`);

      // Same subject again: signed in through the link, no second identity row.
      const second = await ssoSignIn(claimsFor(u.email));
      expect(second.session?.id).toBe(u.id);
      expect(await db.select().from(userIdentities).where(eq(userIdentities.userId, u.id))).toHaveLength(1);

      const entries = await db.select().from(auditTrail).where(eq(auditTrail.entityId, u.id));
      const actions = entries.map((e) => (e.changes as { action?: string } | null)?.action);
      expect(actions).toContain("sso_identity_linked");
      expect(actions).toContain("sso_login");
    });

    it("refuses an email the provider has not verified", async () => {
      const u = await makeUser("sso-unverified", tenantId);
      const res = await ssoSignIn(claimsFor(u.email, { email_verified: false }));
      expect(errorOf(res.location)).toBe("email_not_verified");
      expect(res.session).toBeNull();
      expect(await db.select().from(userIdentities).where(eq(userIdentities.userId, u.id))).toHaveLength(0);
    });

    it("trusts an unverified claim only when the admin turned the check off", async () => {
      const u = await makeUser("sso-entra", tenantId);
      await request(app).put("/sso").set(bearer(adminToken)).send({ displayName: "Test IdP", issuer: idp.issuer, clientId: CLIENT_ID, enabled: true, requireVerifiedEmail: false });
      const res = await ssoSignIn({ sub: "entra-sub-1", email: u.email });
      expect(res.session?.id).toBe(u.id);
      await request(app).put("/sso").set(bearer(adminToken)).send({ displayName: "Test IdP", issuer: idp.issuer, clientId: CLIENT_ID, enabled: true, requireVerifiedEmail: true });
    });

    it("refuses an email outside the tenant's verified domains", async () => {
      const res = await ssoSignIn(claimsFor(`stranger@unverified-${suffix}.example`));
      expect(errorOf(res.location)).toBe("domain_not_allowed");
      expect(res.session).toBeNull();
    });

    it("never links an email that belongs to another organization", async () => {
      const foreign = await makeUser("sso-foreign", otherTenantId);
      const res = await ssoSignIn(claimsFor(foreign.email));
      expect(errorOf(res.location)).toBe("email_in_other_organization");
      expect(res.session).toBeNull();
      expect(await db.select().from(userIdentities).where(eq(userIdentities.userId, foreign.id))).toHaveLength(0);
    });

    it("does not create accounts unless auto-provisioning is on", async () => {
      const email = `newcomer-${suffix}@${DOMAIN}`;
      const res = await ssoSignIn(claimsFor(email));
      expect(errorOf(res.location)).toBe("no_account");
      expect(await db.select().from(users).where(eq(users.email, email))).toHaveLength(0);
    });

    it("auto-provisions with the default role when enabled, and never as an admin", async () => {
      await request(app).put("/sso").set(bearer(adminToken)).send({ displayName: "Test IdP", issuer: idp.issuer, clientId: CLIENT_ID, enabled: true, autoProvision: true, defaultRoleId: workerRoleId });
      const email = `provisioned-${suffix}@${DOMAIN}`;
      const res = await ssoSignIn(claimsFor(email, { name: "Pat Provisioned" }));
      expect(res.session?.email).toBe(email);
      const [created] = await db.select().from(users).where(eq(users.email, email));
      userIds.push(created!.id);
      expect(created).toMatchObject({ tenantId, roleId: workerRoleId, name: "Pat Provisioned" });
      expect(created!.passwordHash).toBeTruthy();
      // The random password is unusable: nobody knows it.
      expect((await request(app).post("/auth/login").send({ email, password: "anything-at-all-123" })).status).toBe(401);

      // Point the default role at an admin role directly in the DB (bypassing the API check): use still refuses.
      await db.update(ssoConnections).set({ defaultRoleId: adminRoleId }).where(eq(ssoConnections.tenantId, tenantId));
      const blocked = await ssoSignIn(claimsFor(`second-${suffix}@${DOMAIN}`));
      expect(errorOf(blocked.location)).toBe("no_account");
      await db.update(ssoConnections).set({ autoProvision: false, defaultRoleId: null }).where(eq(ssoConnections.tenantId, tenantId));
    });

    it("refuses a deactivated account", async () => {
      const u = await makeUser("sso-disabled", tenantId, { isActive: false });
      const res = await ssoSignIn(claimsFor(u.email));
      expect(errorOf(res.location)).toBe("account_disabled");
      expect(res.session).toBeNull();
    });

    it("records refused attempts in the tenant's audit trail", async () => {
      const entries = await db.select().from(auditTrail).where(eq(auditTrail.tenantId, tenantId));
      const denied = entries.filter((e) => (e.changes as { action?: string } | null)?.action === "sso_login_denied");
      expect(denied.length).toBeGreaterThan(0);
      expect(denied.map((e) => (e.changes as { reason: string }).reason)).toContain("domain_not_allowed");
    });
  });

  describe("protocol checks (all done by openid-client)", () => {
    it("rejects a mismatched state, an ID token for another audience, and an expired one", async () => {
      const u = await makeUser("sso-protocol", tenantId);
      expect(errorOf((await ssoSignIn(claimsFor(u.email), { state: "not-the-state" })).location)).toBe("provider_error");
      expect(errorOf((await ssoSignIn(claimsFor(u.email), { aud: "someone-elses-client" })).location)).toBe("provider_error");
      expect(errorOf((await ssoSignIn(claimsFor(u.email), { expired: true })).location)).toBe("provider_error");
      expect(await db.select().from(userIdentities).where(eq(userIdentities.userId, u.id))).toHaveLength(0);
    });

    it("a callback without the browser's flow cookie (or after it was used) is refused", async () => {
      const agent = request.agent(app);
      const start = await agent.get(`/auth/sso/start?tenant=${tenantCode}`);
      const cb = idp.authorize(start.headers.location as string, claimsFor(`x-${suffix}@${DOMAIN}`));
      expect(errorOf(String((await request(app).get(cb)).headers.location))).toBe("session_expired");
      // The flow cookie is single-use: the first callback consumes it, so a replay finds none.
      await agent.get(cb);
      expect(errorOf(String((await agent.get(cb)).headers.location))).toBe("session_expired");
    });

    it("an unknown or SSO-less tenant is sent back to the login page", async () => {
      const res = await request(app).get("/auth/sso/start?tenant=no-such-tenant");
      expect(res.status).toBe(302);
      expect(errorOf(String(res.headers.location))).toBe("not_configured");
    });
  });

  describe("requiring SSO", () => {
    it("blocks password sign-in for everyone except admins", async () => {
      await request(app).put("/sso").set(bearer(adminToken)).send({ displayName: "Test IdP", issuer: idp.issuer, clientId: CLIENT_ID, enabled: true, enforceSso: true });
      const worker = await makeUser("sso-enforced-worker", tenantId);
      const adminUser = await makeUser("sso-enforced-admin", tenantId, { roleId: adminRoleId, mfaRequiredSince: new Date() });

      const blocked = await request(app).post("/auth/login").send({ email: worker.email, password: PASSWORD });
      expect(blocked.status).toBe(403);
      expect(blocked.body.message).toMatch(/single sign-on/i);
      expect((await request(app).post("/auth/login").send({ email: adminUser.email, password: PASSWORD })).status).toBe(200);
      // A wrong password still looks like a wrong password — the SSO notice is not a way to probe accounts.
      expect((await request(app).post("/auth/login").send({ email: worker.email, password: "wrong-password-value" })).status).toBe(401);

      // SSO itself still works for that worker.
      expect((await ssoSignIn(claimsFor(worker.email))).session?.id).toBe(worker.id);

      await request(app).put("/sso").set(bearer(adminToken)).send({ displayName: "Test IdP", issuer: idp.issuer, clientId: CLIENT_ID, enabled: true, enforceSso: false });
      expect((await request(app).post("/auth/login").send({ email: worker.email, password: PASSWORD })).status).toBe(200);
    });

    it("a disabled connection stops SSO sign-in", async () => {
      await request(app).put("/sso").set(bearer(adminToken)).send({ displayName: "Test IdP", issuer: idp.issuer, clientId: CLIENT_ID, enabled: false });
      const res = await request(app).get(`/auth/sso/start?tenant=${tenantCode}`);
      expect(errorOf(String(res.headers.location))).toBe("not_configured");
    });
  });
});
