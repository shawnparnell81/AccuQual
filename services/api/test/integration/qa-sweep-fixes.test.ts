import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment
// for why this category exists and what it needs). Covers the
// backend-verifiable fixes from the full-app QA sweep review: Change
// Management's missing GET /:id route, IoT device registration crashing
// on an all-optional-fields-blank submit, the NCR/CAPA/DI History casing
// mismatch, global search not knowing Work Orders exist, and inventory
// alerts never auto-resolving when stock recovers. The frontend-only
// fixes from that same review (query-cache-survives-logout, the stuck
// maximized window, GenericCreateForm's silent failures, FormEditor's
// uncaught PDF errors) have no backend surface to test here — verified
// live in the browser instead, per that review.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { changeRequests } from "../../src/drizzle/schema/change.js";
import { iotDevices } from "../../src/drizzle/schema/digitalTwin.js";
import { inventoryItems, inventoryAlerts, inventoryMovements, inventoryStock } from "../../src/drizzle/schema/inventory.js";
import { workOrders } from "../../src/drizzle/schema/workOrders.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { aiEmbeddings } from "../../src/drizzle/schema/ai.js";
import { formData } from "../../src/drizzle/schema/forms.js";
import { signAccessToken } from "../../src/utils/jwt.js";

import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
const app = createApp();
const suffix = Date.now();

let companyId: number;
let adminUserId: number;
let adminToken: string;
const userIds: number[] = [];

async function makeUser(department: string | null, roleName = "operator") {
  const [user] = await db.insert(users).values({ email: `qa-fix-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName, department });
}

describe("QA sweep fixes (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;

    await seedDefaultPermissions(companyId);

    const [admin] = await db.insert(users).values({ email: `qa-fix-admin-${suffix}@test.local`, passwordHash: "unused" }).returning();
    adminUserId = admin!.id;
    userIds.push(adminUserId);
    adminToken = signAccessToken({ sub: String(adminUserId), roleId: null, roleName: "admin", department: null });
  });

  afterAll(async () => {
    // Same grace period as the other integration suites — errorHandler.ts's
    // fire-and-forget logFailedTransition and the real ai-worker's async
    // embed jobs can still be landing after this file's own awaits resolve.
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  describe("Finding 6 — Change Management GET /:id", () => {
    it("a newly-created change request can actually be opened, not stuck 404ing", async () => {
      const create = await request(app).post("/change").set("Authorization", `Bearer ${adminToken}`).send({ title: "QA fix test change" });
      expect(create.status).toBe(201);

      const get = await request(app).get(`/change/${create.body.id}`).set("Authorization", `Bearer ${adminToken}`);
      expect(get.status).toBe(200);
      expect(get.body.title).toBe("QA fix test change");
    });
  });

  describe("Finding 10 — IoT device registration with all-optional-fields blank", () => {
    it("registering a brand-new device by ID alone no longer 500s", async () => {
      const res = await request(app).post("/digital-twin/devices").set("Authorization", `Bearer ${adminToken}`).send({ deviceId: `qa-fix-device-${suffix}` });
      expect(res.status).toBe(201);
      expect(res.body.deviceId).toBe(`qa-fix-device-${suffix}`);
      expect(res.body.name).toBeNull();
    });

    it("re-registering the same device with a name now updates it instead of wiping to blank again", async () => {
      const res = await request(app)
        .post("/digital-twin/devices")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ deviceId: `qa-fix-device-${suffix}`, name: "QA Fix Sensor" });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe("QA Fix Sensor");

      // Registering it again with nothing but the id must preserve that name
      // (COALESCE against the existing row), not null it back out.
      const again = await request(app).post("/digital-twin/devices").set("Authorization", `Bearer ${adminToken}`).send({ deviceId: `qa-fix-device-${suffix}` });
      expect(again.status).toBe(201);
      expect(again.body.name).toBe("QA Fix Sensor");
    });
  });

  describe("Finding 3 — History tab casing (NCR)", () => {
    it("a new NCR's own 'create' event is visible in its own History, not silently dropped", async () => {
      const create = await request(app).post("/ncr").set("Authorization", `Bearer ${adminToken}`).send({ title: "QA fix history test", description: "x" });
      expect(create.status).toBe(201);

      const history = await request(app).get(`/workflow/history/ncr/${create.body.id}`).set("Authorization", `Bearer ${adminToken}`);
      expect(history.status).toBe(200);
      expect(history.body.some((entry: { action: string }) => entry.action === "create")).toBe(true);
    });
  });

  describe("Finding 11 — global search knows Work Orders exist", () => {
    it("a real work order is findable by its id", async () => {
      const [item] = await db.insert(inventoryItems).values({ sku: `QA-FIX-SEARCH-${suffix}`, minLevel: "0" }).returning();
      const [wo] = await db.insert(workOrders).values({ itemId: item!.id, quantityPlanned: "5" }).returning();

      const res = await request(app).get(`/search?q=${wo!.id}`).set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.results.some((r: { type: string; id: number }) => r.type === "WO" && r.id === wo!.id)).toBe(true);
    });
  });

  describe("Finding 7 — inventory alerts auto-acknowledge when stock recovers", () => {
    it("a below_min alert closes itself once a real movement brings stock back above min", async () => {
      const [item] = await db.insert(inventoryItems).values({ sku: `QA-FIX-ALERT-${suffix}`, minLevel: "10" }).returning();

      // Drive it below min — expect a real, open below_min alert.
      const consume = await request(app).post(`/inventory/items/${item!.id}/movement`).set("Authorization", `Bearer ${adminToken}`).send({ movementType: "receive", quantity: 5, toLocation: "default" });
      expect(consume.status).toBe(201);

      const afterLow = await db.select().from(inventoryAlerts).where(eq(inventoryAlerts.itemId, item!.id));
      expect(afterLow.length).toBe(1);
      expect(afterLow[0]?.alertType).toBe("below_min");
      expect(afterLow[0]?.acknowledgedAt).toBeNull();

      // Bring it back above min via a real movement.
      const receive = await request(app).post(`/inventory/items/${item!.id}/movement`).set("Authorization", `Bearer ${adminToken}`).send({ movementType: "receive", quantity: 20, toLocation: "default" });
      expect(receive.status).toBe(201);

      const afterRecovered = await db.select().from(inventoryAlerts).where(eq(inventoryAlerts.itemId, item!.id));
      expect(afterRecovered.length).toBe(1);
      expect(afterRecovered[0]?.acknowledgedAt).not.toBeNull();
    });
  });
});
