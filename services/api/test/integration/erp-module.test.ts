// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Full-System Audit finding L2: ERP had zero dedicated test coverage — no
// RBAC (purchasing/material_management edit, quality read-only per
// departmentAccess.ts, plus send/cancel being purchasing-only specifically)
// and no coverage of the real draft -> sent -> cancelled status guards.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { suppliers } from "../../src/drizzle/schema/supplier.js";
import { inventoryItems } from "../../src/drizzle/schema/inventory.js";
import { erpPurchaseOrders, erpPoLineItems } from "../../src/drizzle/schema/erp.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
let supplierId: number;
let itemId: number;
const userIds: number[] = [];
let purchasingToken: string;
let qualityToken: string;

async function makeUser(department: string | null) {
  const [user] = await db.insert(users).values({ tenantId, email: `erp-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName: "operator", department });
}

async function createPo(token: string) {
  const res = await request(app)
    .post("/erp/purchase-orders")
    .set("Authorization", `Bearer ${token}`)
    .send({ supplierId, lineItems: [{ itemId, quantity: 10 }] });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe("ERP module (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `ERP Test Tenant ${suffix}`, code: `erp-test-${suffix}` }).returning();
    tenantId = tenant!.id;
    await seedDefaultPermissions(tenantId);

    purchasingToken = await makeUser("purchasing");
    qualityToken = await makeUser("quality");

    const [supplier] = await db.insert(suppliers).values({ tenantId, name: "ERP Test Supplier" }).returning();
    supplierId = supplier!.id;
    const [item] = await db.insert(inventoryItems).values({ tenantId, sku: `ERP-TEST-${suffix}` }).returning();
    itemId = item!.id;
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, tenantId));
    await db.delete(erpPoLineItems).where(eq(erpPoLineItems.tenantId, tenantId));
    await db.delete(erpPurchaseOrders).where(eq(erpPurchaseOrders.tenantId, tenantId));
    await db.delete(inventoryItems).where(eq(inventoryItems.tenantId, tenantId));
    await db.delete(suppliers).where(eq(suppliers.tenantId, tenantId));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, tenantId));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it("quality (read-only) cannot create a purchase order", async () => {
    const res = await request(app)
      .post("/erp/purchase-orders")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ supplierId, lineItems: [{ itemId, quantity: 5 }] });
    expect(res.status).toBe(403);
  });

  it("quality can read purchase orders (real read access)", async () => {
    const id = await createPo(purchasingToken);
    const res = await request(app).get(`/erp/purchase-orders/${id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(200);
  });

  it("a fresh PO starts as draft", async () => {
    const id = await createPo(purchasingToken);
    const res = await request(app).get(`/erp/purchase-orders/${id}`).set("Authorization", `Bearer ${purchasingToken}`);
    expect(res.body.status).toBe("draft");
  });

  it("quality (edit-less on erp's finer send/cancel gate) cannot send a PO even though purchasing created it", async () => {
    const id = await createPo(purchasingToken);
    const res = await request(app).post(`/erp/purchase-orders/${id}/send`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(403);
  });

  it("purchasing can send a draft PO, and cannot send it again", async () => {
    const id = await createPo(purchasingToken);
    const send = await request(app).post(`/erp/purchase-orders/${id}/send`).set("Authorization", `Bearer ${purchasingToken}`);
    expect(send.status).toBe(200);
    expect(send.body.status).toBe("sent");

    const sendAgain = await request(app).post(`/erp/purchase-orders/${id}/send`).set("Authorization", `Bearer ${purchasingToken}`);
    expect(sendAgain.status).toBe(400);
  });

  it("purchasing can cancel a PO, and cannot cancel it again once cancelled", async () => {
    const id = await createPo(purchasingToken);
    const cancel = await request(app).post(`/erp/purchase-orders/${id}/cancel`).set("Authorization", `Bearer ${purchasingToken}`);
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe("cancelled");

    const cancelAgain = await request(app).post(`/erp/purchase-orders/${id}/cancel`).set("Authorization", `Bearer ${purchasingToken}`);
    expect(cancelAgain.status).toBe(400);

    const trail = await db.select().from(auditTrail).where(eq(auditTrail.entityId, id));
    expect(trail.some((t) => t.entityType === "PurchaseOrder" && t.action === "status_change")).toBe(true);
  });

  it("creating a purchase order with no line items is rejected by validation", async () => {
    const res = await request(app).post("/erp/purchase-orders").set("Authorization", `Bearer ${purchasingToken}`).send({ supplierId, lineItems: [] });
    expect(res.status).toBe(400);
  });
});
