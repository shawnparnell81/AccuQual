// Real DB + real HTTP path for Settings → ERP / NetSuite, against a local fake
// NetSuite (token endpoint + REST records). No real NetSuite is ever called.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { ensureTestCompany } from "../helpers/company.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { clearNetSuiteTokenCache } from "../../src/modules/netsuite/netsuiteClient.js";

const app = createApp();
const suffix = Date.now();
const userIds: number[] = [];
let adminToken: string;
let otherToken: string;
let fake: Server;
const seen: { method: string; path: string }[] = [];
let tokenRequests = 0;

const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1", privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const other = generateKeyPairSync("ec", { namedCurve: "prime256v1", privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

async function makeUser(roleName: string, department: string | null) {
  const [u] = await db.insert(users).values({ email: `ns-${roleName}-${suffix}-${Math.random().toString(36).slice(2, 6)}@test.local`, passwordHash: "unused", department }).returning();
  userIds.push(u!.id);
  return signAccessToken({ sub: String(u!.id), roleId: null, roleName, department });
}

function startFakeNetSuite(): Promise<string> {
  fake = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const path = (req.url ?? "").split("?")[0]!;
      seen.push({ method: req.method ?? "", path });
      const json = (status: number, obj: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      if (req.method === "POST" && path === "/services/rest/auth/oauth2/v1/token") {
        tokenRequests++;
        const p = new URLSearchParams(body);
        if (p.get("grant_type") !== "client_credentials" || p.get("client_assertion_type") !== "urn:ietf:params:oauth:client-assertion-type:jwt-bearer") return json(400, { error: "invalid_request" });
        const [h, pl, s] = (p.get("client_assertion") ?? "").split(".");
        const header = JSON.parse(Buffer.from(h!, "base64url").toString());
        const claims = JSON.parse(Buffer.from(pl!, "base64url").toString());
        if (claims.iss !== "CLIENT-1") return json(401, { error: "invalid_client" });
        const ok = header.kid === "CERT-1" && verify("sha256", Buffer.from(`${h}.${pl}`), { key: createPublicKey(ec.publicKey), dsaEncoding: "ieee-p1363" }, Buffer.from(s!, "base64url"));
        if (!ok) return json(400, { error: "invalid_grant" });
        return json(200, { access_token: "eyJfake.eyJtoken.sig", expires_in: 3600, token_type: "bearer" });
      }
      if (req.headers.authorization !== "Bearer eyJfake.eyJtoken.sig") return json(401, { title: "Unauthorized" });
      if (req.method === "GET" && path === "/services/rest/record/v1/metadata-catalog") return json(200, { items: [] });
      if (req.method === "GET" && path === "/services/rest/record/v1/location") return json(200, { items: [{ id: "1" }], count: 1 });
      if (req.method === "GET" && path === "/services/rest/record/v1/customrecord_fai") return json(403, { "o:errorDetails": [{ detail: "Permission Violation", "o:errorCode": "INSUFFICIENT_PERMISSION" }] });
      return json(404, { "o:errorDetails": [{ detail: "Record type not found", "o:errorCode": "NONEXISTENT_ID" }] });
    });
  });
  return new Promise((r) => fake.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(fake.address() as AddressInfo).port}`)));
}

describe("NetSuite connector settings (fake NetSuite)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    await db.update(company).set({ erpSyncSettings: {} }).where(eq(company.id, co!.id));
    adminToken = await makeUser("admin", null);
    otherToken = await makeUser("operator", "purchasing");
    process.env.NETSUITE_API_BASE_URL_OVERRIDE = await startFakeNetSuite();
    clearNetSuiteTokenCache();
  });

  afterAll(async () => {
    delete process.env.NETSUITE_API_BASE_URL_OVERRIDE;
    await new Promise<void>((r) => fake.close(() => r()));
    await db.delete(auditTrail).where(inArray(auditTrail.performedBy, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("non-admins get 403 on every NetSuite route", async () => {
    const auth = { Authorization: `Bearer ${otherToken}` };
    expect((await request(app).get("/settings/netsuite").set(auth)).status).toBe(403);
    expect((await request(app).post("/settings/netsuite").set(auth).send({ accountId: "1" })).status).toBe(403);
    expect((await request(app).delete("/settings/netsuite").set(auth)).status).toBe(403);
    expect((await request(app).post("/settings/netsuite/test").set(auth)).status).toBe(403);
    expect((await request(app).post("/settings/netsuite/modules/fai/check").set(auth)).status).toBe(403);
  });

  it("test before setup says what's missing", async () => {
    const res = await request(app).post("/settings/netsuite/test").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe("not_configured");
    expect(seen.length).toBe(0);
  });

  it("rejects a bad account ID and a key that doesn't fit", async () => {
    const a = await request(app).post("/settings/netsuite").set("Authorization", `Bearer ${adminToken}`).send({ accountId: "evil.com/x" });
    expect(a.status).toBe(400);
    const b = await request(app).post("/settings/netsuite").set("Authorization", `Bearer ${adminToken}`).send({ privateKey: "nope" });
    expect(b.status).toBe(400);
  });

  it("saves settings write-only: the key is encrypted and never returned", async () => {
    const res = await request(app)
      .post("/settings/netsuite")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ accountId: "1234567_sb1", clientId: "CLIENT-1", certificateId: "CERT-1", privateKey: ec.privateKey, keyAlgorithm: "auto" });
    expect(res.status).toBe(200);
    expect(res.body.accountId).toBe("1234567_SB1");
    expect(res.body.environment).toBe("Sandbox");
    expect(res.body.domain).toBe("1234567-sb1.suitetalk.api.netsuite.com");
    expect(res.body.hasPrivateKey).toBe(true);
    expect(res.body.detectedAlgorithm).toBe("ES256");
    expect(JSON.stringify(res.body)).not.toContain("PRIVATE KEY");
    const [co] = await db.select().from(company);
    const storedKey = co!.erpSyncSettings?.netsuite?.privateKeyEncrypted ?? "";
    expect(storedKey).not.toContain("PRIVATE");
    expect(storedKey.split(":").length).toBe(3);
  });

  it("Test connection signs in, makes one read, and is recorded in history", async () => {
    const res = await request(app).post("/settings/netsuite/test").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.environment).toBe("Sandbox");
    expect(typeof res.body.durationMs).toBe("number");
    expect(seen.map((s) => s.method)).toEqual(["POST", "GET"]);
    const view = await request(app).get("/settings/netsuite").set("Authorization", `Bearer ${adminToken}`);
    expect(view.body.lastTest.ok).toBe(true);
    expect(view.body.history[0].action).toBe("connection_test");
    expect(view.body.history[0].description).toMatch(/passed/);
  });

  it("module checks report Reachable / No permission / Not found / Not configured, reusing the cached token", async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };
    const before = tokenRequests;
    expect((await request(app).post("/settings/netsuite/modules/inventory/check").set(auth)).body.status).toBe("reachable");
    expect((await request(app).post("/settings/netsuite/modules/fai/check").set(auth)).body.status).toBe("not_configured");
    await request(app).post("/settings/netsuite").set(auth).send({ modules: { fai: { recordType: "customrecord_fai", enabled: true }, productAlert: { recordType: "customrecord_missing" } } });
    expect((await request(app).post("/settings/netsuite/modules/fai/check").set(auth)).body.status).toBe("no_permission");
    expect((await request(app).post("/settings/netsuite/modules/productAlert/check").set(auth)).body.status).toBe("not_found");
    expect(tokenRequests).toBe(before);
    expect((await request(app).post("/settings/netsuite/modules/bogus/check").set(auth)).status).toBe(404);
    expect(seen.every((s) => s.method === "GET" || s.path.endsWith("/oauth2/v1/token"))).toBe(true);
  });

  it("a wrong key gives NetSuite's certificate guidance", async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };
    await request(app).post("/settings/netsuite").set(auth).send({ privateKey: other.privateKey });
    const res = await request(app).post("/settings/netsuite/test").set(auth);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe("invalid_grant");
    expect(res.body.guidance).toMatch(/Certificate ID/);
  });

  it("the audit trail never holds a key or token", async () => {
    const rows = await db.select().from(auditTrail).where(eq(auditTrail.entityType, "NetSuiteConnection"));
    expect(rows.length).toBeGreaterThan(4);
    const all = JSON.stringify(rows);
    expect(all).not.toContain("PRIVATE KEY");
    expect(all).not.toContain("eyJfake");
    expect(rows.some((r) => (r.changes as { event?: string })?.event === "key_replaced")).toBe(true);
    expect(rows.some((r) => (r.changes as { event?: string })?.event === "module_enabled")).toBe(true);
  });

  it("Remove connection deletes the saved details", async () => {
    const res = await request(app).delete("/settings/netsuite").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.hasPrivateKey).toBe(false);
    expect(res.body.history[0].action).toBe("remove");
  });
});
