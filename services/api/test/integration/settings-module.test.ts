// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Covers the three Settings integrations from the "Settings → Feasibility/
// Inventory/ERP Sync" spec: GET/POST /settings/{feasibility,inventory,
// erp-sync}, their RBAC (requireAnyDepartment / requireRole), audit trail
// logging, and — the actual point of "integration", not just config storage
// — that each real module (feasibility.controller.ts, inventory.service.ts/
// controller.ts/costing.ts, settings.erpSync.ts) genuinely reads and acts on
// these settings.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray, and } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { feasibilityReviews } from "../../src/drizzle/schema/feasibility.js";
import { inventoryItems, inventoryMovements, inventoryStock, inventoryAlerts } from "../../src/drizzle/schema/inventory.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { notificationLog } from "../../src/drizzle/schema/notifications.js";
import { signAccessToken } from "../../src/utils/jwt.js";

import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
const app = createApp();
const suffix = Date.now();

let tenantId: number;
const userIds: number[] = [];
const feasibilityIds: number[] = [];
const itemIds: number[] = [];

let qualityToken: string;
let engineeringToken: string;
let productionToken: string;
let purchasingToken: string;
let adminToken: string;

// Sets `department` on the real users row too (not just the JWT claim) —
// unlike most other test files' makeUser, this one needs it for real:
// notifyDepartment queries the actual users table, not the JWT, to find
// recipients (see the "notificationsEnabled" test below).
async function makeUser(department: string | null, roleName = "operator") {
  const [user] = await db
    .insert(users)
    .values({ tenantId, email: `settings-test-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused", department })
    .returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName, department });
}

describe("Settings module (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `Settings Test Tenant ${suffix}`, code: `settings-test-${suffix}` }).returning();
    tenantId = tenant!.id;

    await seedDefaultPermissions(tenantId);

    qualityToken = await makeUser("quality");
    engineeringToken = await makeUser("engineering");
    productionToken = await makeUser("production");
    purchasingToken = await makeUser("purchasing");
    adminToken = await makeUser(null, "admin");
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(inArray(auditTrail.performedBy, userIds));
    await db.delete(notificationLog).where(eq(notificationLog.tenantId, tenantId));
    for (const id of feasibilityIds) await db.delete(feasibilityReviews).where(eq(feasibilityReviews.id, id));
    for (const id of itemIds) {
      await db.delete(inventoryAlerts).where(eq(inventoryAlerts.itemId, id));
      await db.delete(inventoryMovements).where(eq(inventoryMovements.itemId, id));
      await db.delete(inventoryStock).where(eq(inventoryStock.itemId, id));
      await db.delete(inventoryItems).where(eq(inventoryItems.id, id));
    }
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, tenantId));

    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  // ============================================================
  // Settings → Feasibility Module integration
  // ============================================================

  describe("Feasibility settings", () => {
    it("production (not quality/engineering/admin) cannot update feasibility settings", async () => {
      const res = await request(app).post("/settings/feasibility").set("Authorization", `Bearer ${productionToken}`).send({ defaultRiskLevel: "high" });
      expect(res.status).toBe(403);
    });

    it("quality configures defaults, requiredDocuments, and notifications — logged to the audit trail", async () => {
      const res = await request(app)
        .post("/settings/feasibility")
        .set("Authorization", `Bearer ${qualityToken}`)
        .send({
          defaultRiskLevel: "high",
          autoAssignOwner: true,
          requiredDocuments: ["Customer Drawing"],
          notificationsEnabled: true,
        });
      expect(res.status).toBe(200);
      expect(res.body.defaultRiskLevel).toBe("high");

      const [row] = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "FeasibilitySettings"), eq(auditTrail.tenantId, tenantId)));
      expect(row).toBeTruthy();
    });

    it("creating a review with no ownerId picks up autoAssignOwner + defaultRiskLevel seeds every assessment area", async () => {
      const res = await request(app).post("/feasibility").set("Authorization", `Bearer ${engineeringToken}`).send({ customerName: "Uses tenant defaults" });
      expect(res.status).toBe(201);
      expect(res.body.designRiskLevel).toBe("high");
      expect(res.body.financialRiskLevel).toBe("high");
      expect(res.body.ownerId).toBeTruthy(); // auto-assigned to the creating user
      feasibilityIds.push(res.body.id);
    });

    it("finalize is blocked when a required document hasn't been marked provided", async () => {
      const id = feasibilityIds[0]!;
      const res = await request(app).post(`/feasibility/${id}/finalize`).set("Authorization", `Bearer ${engineeringToken}`);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Customer Drawing/);
    });

    it("marking the document provided unblocks finalize, and (notificationsEnabled) writes a real notification_log row", async () => {
      const id = feasibilityIds[0]!;
      const update = await request(app).put(`/feasibility/${id}`).set("Authorization", `Bearer ${engineeringToken}`).send({ providedDocuments: ["Customer Drawing"] });
      expect(update.status).toBe(200);

      const finalize = await request(app).post(`/feasibility/${id}/finalize`).set("Authorization", `Bearer ${engineeringToken}`);
      expect(finalize.status).toBe(200);
      expect(finalize.body.status).toBe("final");

      const notifications = await db.select().from(notificationLog).where(and(eq(notificationLog.tenantId, tenantId), eq(notificationLog.relatedEntityId, id)));
      expect(notifications.length).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // Settings → Inventory Module expansion
  // ============================================================

  describe("Inventory settings", () => {
    it("quality (not production/purchasing/admin) cannot update inventory settings", async () => {
      const res = await request(app).post("/settings/inventory").set("Authorization", `Bearer ${qualityToken}`).send({ autoGenerateLotNumbers: true });
      expect(res.status).toBe(403);
    });

    it("purchasing configures lot/serial generation, aging, reservation, cost rounding, and audit frequency", async () => {
      const res = await request(app)
        .post("/settings/inventory")
        .set("Authorization", `Bearer ${purchasingToken}`)
        .send({
          autoGenerateLotNumbers: true,
          lotNumberFormat: "LOT-{SEQ}",
          agingRules: { warningDays: 30, criticalDays: 90 },
          reservationRules: { allowNegativeAllocation: false, autoReleaseAfterDays: 1 },
          costAdjustmentRules: { method: "latest", roundingPrecision: 2 },
          auditFrequency: "monthly",
        });
      expect(res.status).toBe(200);
      expect(res.body.lotNumberFormat).toBe("LOT-{SEQ}");
    });

    it("a receive movement auto-generates a lot number from the configured format", async () => {
      const item = await request(app).post("/inventory/items").set("Authorization", `Bearer ${purchasingToken}`).send({ sku: `SET-TEST-${suffix}`, minLevel: 0 });
      expect(item.status).toBe(201);
      itemIds.push(item.body.id);

      const movement = await request(app)
        .post(`/inventory/items/${item.body.id}/movement`)
        .set("Authorization", `Bearer ${purchasingToken}`)
        .send({ movementType: "receive", quantity: 10 });
      expect(movement.status).toBe(201);
      expect(movement.body.movement.lotNumber).toBe("LOT-0001");
    });

    it("cycleCountDue is true before any count, and false right after one is recorded", async () => {
      const id = itemIds[0]!;
      const before = await request(app).get(`/inventory/items/${id}`).set("Authorization", `Bearer ${purchasingToken}`);
      expect(before.body.cycleCountDue).toBe(true); // auditFrequency set, never counted

      const counted = await request(app).post(`/inventory/items/${id}/count`).set("Authorization", `Bearer ${productionToken}`).send({ notes: "Physical count matched system" });
      expect(counted.status).toBe(200);
      expect(counted.body.lastCountedAt).toBeTruthy();

      const after = await request(app).get(`/inventory/items/${id}`).set("Authorization", `Bearer ${purchasingToken}`);
      expect(after.body.cycleCountDue).toBe(false);
    });

    it("reserve is blocked past on-hand when allowNegativeAllocation is off, then succeeds within on-hand and releases cleanly", async () => {
      const id = itemIds[0]!;
      const overReserve = await request(app).post(`/inventory/items/${id}/reserve`).set("Authorization", `Bearer ${productionToken}`).send({ quantity: 999 });
      expect(overReserve.status).toBe(400);

      const reserve = await request(app).post(`/inventory/items/${id}/reserve`).set("Authorization", `Bearer ${productionToken}`).send({ quantity: 5 });
      expect(reserve.status).toBe(201);
      expect(Number(reserve.body.stock[0].allocated)).toBe(5);

      const release = await request(app).post(`/inventory/items/${id}/release`).set("Authorization", `Bearer ${productionToken}`).send({ quantity: 5 });
      expect(release.status).toBe(201);
      expect(Number(release.body.stock[0].allocated)).toBe(0);
    });
  });

  // ============================================================
  // Settings → ERP Sync Engine
  // ============================================================

  describe("ERP Sync settings", () => {
    it("non-admin cannot read or update ERP Sync settings", async () => {
      const getRes = await request(app).get("/settings/erp-sync").set("Authorization", `Bearer ${purchasingToken}`);
      expect(getRes.status).toBe(403);
      const postRes = await request(app).post("/settings/erp-sync").set("Authorization", `Bearer ${purchasingToken}`).send({ schedule: "daily" });
      expect(postRes.status).toBe(403);
    });

    it("triggering a sync with no webhook configured is honestly reported as skipped, not a fake success", async () => {
      const res = await request(app).post("/settings/erp-sync/trigger").set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(202);
      expect(res.body.status).toBe("skipped");
    });

    it("admin configures a real webhook + secret, and a triggered sync actually POSTs a signed payload to it", async () => {
      let received: { body: unknown; signature: string | undefined } | undefined;
      const server = createServer((req, res) => {
        let raw = "";
        req.on("data", (chunk) => (raw += chunk));
        req.on("end", () => {
          received = { body: JSON.parse(raw), signature: req.headers["x-accuqual-signature"] as string | undefined };
          res.writeHead(200);
          res.end("ok");
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as AddressInfo).port;
      const webhookUrl = `http://127.0.0.1:${port}/sync`;

      const configure = await request(app)
        .post("/settings/erp-sync")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ webhookUrl, webhookSecret: "test-secret", modulesEnabled: ["inventory"], direction: "push" });
      expect(configure.status).toBe(200);
      expect(configure.body.hasWebhookSecret).toBe(true);

      const trigger = await request(app).post("/settings/erp-sync/trigger").set("Authorization", `Bearer ${adminToken}`);
      expect(trigger.status).toBe(202);
      expect(trigger.body.status).toBe("success");
      expect(trigger.body.history[0].status).toBe("success");

      await new Promise((r) => setTimeout(r, 50));
      await new Promise<void>((resolve) => server.close(() => resolve()));

      expect(received).toBeTruthy();
      expect((received!.body as { modules: string[] }).modules).toEqual(["inventory"]);
      const expectedSignature = createHmac("sha256", "test-secret").update(JSON.stringify(received!.body)).digest("hex");
      expect(received!.signature).toBe(expectedSignature);

      const [row] = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "ErpSyncSettings"), eq(auditTrail.tenantId, tenantId)));
      expect(row).toBeTruthy();
    });
  });
});
