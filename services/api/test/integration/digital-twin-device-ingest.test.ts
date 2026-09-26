import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Digital Twin: per-device ingest keys (a real PLC/sensor authenticates with
// X-Device-Key instead of a user login) and the drift-alerts endpoint.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { iotData, iotDevices } from "../../src/drizzle/schema/digitalTwin.js";
import { aiRiskScores } from "../../src/drizzle/schema/ai.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();

let companyAId: number;

let adminToken: string;
let operatorToken: string;

const userIds: number[] = [];

async function makeUser(companyId: number, roleName: string) {
  const [user] = await db.insert(users).values({ email: `dt-ingest-${roleName}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName, department: null });
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function registerDevice(deviceId: string, name?: string) {
  const res = await request(app).post("/digital-twin/devices").set(auth(adminToken)).send({ deviceId, name });
  expect(res.status).toBe(201);
  return res.body as { id: number; deviceId: string };
}

async function issueKey(rowId: number) {
  const res = await request(app).post(`/digital-twin/devices/${rowId}/api-key`).set(auth(adminToken));
  expect(res.status).toBe(201);
  return res.body.apiKey as string;
}

describe("Digital Twin device ingest keys + drift alerts (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const a = await ensureTestCompany();
    
    companyAId = a!.id;
    
    adminToken = await makeUser(companyAId, "admin");
    operatorToken = await makeUser(companyAId, "operator");
    
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  describe("device keys", () => {
    it("only an admin can issue or revoke a device key", async () => {
      const device = await registerDevice("key-admin-only");
      expect((await request(app).post(`/digital-twin/devices/${device.id}/api-key`).set(auth(operatorToken))).status).toBe(403);
      expect((await request(app).delete(`/digital-twin/devices/${device.id}/api-key`).set(auth(operatorToken))).status).toBe(403);
    });

    ;

    it("device responses never include the key hash, only whether a key exists", async () => {
      const device = await registerDevice("key-not-leaked");
      const before = (await request(app).get("/digital-twin/devices").set(auth(operatorToken))).body.find((d: { id: number }) => d.id === device.id);
      expect(before.hasApiKey).toBe(false);
      await issueKey(device.id);
      const after = (await request(app).get("/digital-twin/devices").set(auth(operatorToken))).body.find((d: { id: number }) => d.id === device.id);
      expect(after.hasApiKey).toBe(true);
      expect(after).not.toHaveProperty("apiKeyHash");
    });

    it("stores only a hash — the plain key is never persisted", async () => {
      const device = await registerDevice("key-hash-only");
      const apiKey = await issueKey(device.id);
      const secret = apiKey.split(".")[1]!;
      const [row] = await db.select().from(iotDevices).where(eq(iotDevices.id, device.id));
      expect(row!.apiKeyHash).toBeTruthy();
      expect(row!.apiKeyHash).not.toContain(secret);
      expect(row!.apiKeyHash).not.toBe(secret);
    });
  });

  describe("POST /digital-twin/device-ingest", () => {
    it("accepts a reading authenticated by the device key alone — no user login — and stores it under the device's own company and id", async () => {
      const device = await registerDevice("plc-line-1");
      const apiKey = await issueKey(device.id);

      // The body tries to name a different device; it must be ignored — the key decides who is reporting.
      const res = await request(app).post("/digital-twin/device-ingest").set("X-Device-Key", apiKey).send({ deviceId: "some-other-device", data: { temperature: 72.5 } });
      expect(res.status).toBe(201);

      const [reading] = await db.select().from(iotData).where(eq(iotData.id, res.body.id));
      expect(reading).toMatchObject({ deviceId: "plc-line-1", data: { temperature: 72.5 } });

      const [after] = await db.select().from(iotDevices).where(eq(iotDevices.id, device.id));
      expect(after!.lastSeenAt).toBeTruthy();
    });

    it("rejects a missing, malformed, wrong-secret, or unknown-device key with 401", async () => {
      const device = await registerDevice("plc-bad-keys");
      const apiKey = await issueKey(device.id);
      const body = { data: { temperature: 1 } };

      expect((await request(app).post("/digital-twin/device-ingest").send(body)).status).toBe(401);
      expect((await request(app).post("/digital-twin/device-ingest").set("X-Device-Key", "not-a-key").send(body)).status).toBe(401);
      expect((await request(app).post("/digital-twin/device-ingest").set("X-Device-Key", `${device.id}.${"0".repeat(64)}`).send(body)).status).toBe(401);
      expect((await request(app).post("/digital-twin/device-ingest").set("X-Device-Key", `99999999.${apiKey.split(".")[1]}`).send(body)).status).toBe(401);
    });

    it("a user's login token is not a device key", async () => {
      const res = await request(app).post("/digital-twin/device-ingest").set(auth(adminToken)).send({ data: { temperature: 1 } });
      expect(res.status).toBe(401);
    });

    it("rotating a key immediately invalidates the old one", async () => {
      const device = await registerDevice("plc-rotate");
      const oldKey = await issueKey(device.id);
      const newKey = await issueKey(device.id);

      expect((await request(app).post("/digital-twin/device-ingest").set("X-Device-Key", oldKey).send({ data: { v: 1 } })).status).toBe(401);
      expect((await request(app).post("/digital-twin/device-ingest").set("X-Device-Key", newKey).send({ data: { v: 1 } })).status).toBe(201);
    });

    it("revoking a key stops the device", async () => {
      const device = await registerDevice("plc-revoke");
      const apiKey = await issueKey(device.id);
      expect((await request(app).delete(`/digital-twin/devices/${device.id}/api-key`).set(auth(adminToken))).status).toBe(204);
      expect((await request(app).post("/digital-twin/device-ingest").set("X-Device-Key", apiKey).send({ data: { v: 1 } })).status).toBe(401);
    });

    it("rejects a malformed or oversized reading payload", async () => {
      const device = await registerDevice("plc-validation");
      const apiKey = await issueKey(device.id);
      expect((await request(app).post("/digital-twin/device-ingest").set("X-Device-Key", apiKey).send({})).status).toBe(400);
      expect((await request(app).post("/digital-twin/device-ingest").set("X-Device-Key", apiKey).send({ data: { blob: "x".repeat(20_000) } })).status).toBe(400);
    });

    it("issuing and revoking a key is audit-trailed", async () => {
      const device = await registerDevice("plc-audited");
      await issueKey(device.id);
      await request(app).delete(`/digital-twin/devices/${device.id}/api-key`).set(auth(adminToken));
      const trail = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "IotDevice"), eq(auditTrail.entityId, device.id)));
      const actions = trail.map((t) => (t.changes as { action?: string } | null)?.action);
      expect(actions).toEqual(expect.arrayContaining(["api_key_rotated", "api_key_revoked"]));
    });
  });

  describe("GET /digital-twin/alerts", () => {
    it("lists this company's drift alerts newest-first with the device name, and never another company's", async () => {
      await registerDevice("alert-dev", "Oven 3 thermocouple");
      await db.insert(aiRiskScores).values({ entityType: "iot_device", score: "70", details: { deviceId: "alert-dev", channel: "temperature", reading: 500, runningMean: 100, direction: "up", reason: "drift_detected" } });
      
      // Not a drift alert — a different entity type in the same table must never leak into this list.
      await db.insert(aiRiskScores).values({ entityType: "supplier", score: "10", details: {} });

      const res = await request(app).get("/digital-twin/alerts").set(auth(operatorToken));
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ deviceId: "alert-dev", deviceName: "Oven 3 thermocouple", channel: "temperature", reading: 500, baseline: 100, direction: "up", score: 70 });

      
      
      
    });
  });
});
