// Real-DB integration test (see tenant-isolation.test.ts's header comment
// for why this category exists). Covers the two new real modules built for
// AI Work Order Planning / AI PR Justification (see the AI modules
// review): Work Orders' department gate + status lifecycle + the real
// inventory "produce" movement completing one triggers, and Purchase
// Requisitions' broader-than-usual "any requesting department may create"
// gate plus its purchasing-only approve/convert-to-PO path.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { suppliers } from "../../src/drizzle/schema/supplier.js";
import { inventoryItems, inventoryMovements, inventoryStock } from "../../src/drizzle/schema/inventory.js";
import { workOrders } from "../../src/drizzle/schema/workOrders.js";
import { erpPurchaseOrders, erpPoLineItems, erpPurchaseRequisitions } from "../../src/drizzle/schema/erp.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
const app = createApp();
const suffix = Date.now();

let tenantId: number;
let supplierId: number;
let itemId: number;
let workOrderId: number;
let requisitionId: number;
let purchaseOrderId: number | undefined;
const userIds: number[] = [];

let productionUserId: number;
let qualityUserId: number;
let purchasingUserId: number;
let engineeringUserId: number;
let customerServiceUserId: number;

let productionToken: string;
let qualityToken: string;
let purchasingToken: string;
let engineeringToken: string;
let customerServiceToken: string;

async function makeUser(department: string) {
  const [user] = await db.insert(users).values({ tenantId, email: `wopr-test-${department}-${suffix}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return user!.id;
}

function tokenFor(userId: number, department: string | null) {
  return signAccessToken({ sub: String(userId), tenantId, roleId: null, roleName: "operator", department });
}

describe("Work Orders + Purchase Requisitions (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `WO/PR Test Tenant ${suffix}`, code: `wopr-test-${suffix}` }).returning();
    tenantId = tenant!.id;

    await seedDefaultPermissions(tenantId);

    const [supplier] = await db.insert(suppliers).values({ tenantId, name: `WO/PR Test Supplier ${suffix}` }).returning();
    supplierId = supplier!.id;

    const [item] = await db.insert(inventoryItems).values({ tenantId, sku: `WOPR-${suffix}`, minLevel: "5", defaultSupplierId: supplierId }).returning();
    itemId = item!.id;

    productionUserId = await makeUser("production");
    qualityUserId = await makeUser("quality");
    purchasingUserId = await makeUser("purchasing");
    engineeringUserId = await makeUser("engineering");
    customerServiceUserId = await makeUser("customer_service");

    productionToken = tokenFor(productionUserId, "production");
    qualityToken = tokenFor(qualityUserId, "quality");
    purchasingToken = tokenFor(purchasingUserId, "purchasing");
    engineeringToken = tokenFor(engineeringUserId, "engineering");
    customerServiceToken = tokenFor(customerServiceUserId, "customer_service");
  });

  afterAll(async () => {
    // Same grace period as the other integration suites — errorHandler.ts's
    // fire-and-forget logFailedTransition can still be writing its own
    // audit_trail row for a just-completed 403/400 test.
    await new Promise((r) => setTimeout(r, 200));
    await db.delete(auditTrail).where(inArray(auditTrail.performedBy, userIds));
    if (workOrderId) await db.delete(workOrders).where(eq(workOrders.id, workOrderId));
    if (requisitionId) await db.delete(erpPurchaseRequisitions).where(eq(erpPurchaseRequisitions.id, requisitionId));
    if (purchaseOrderId) {
      await db.delete(erpPoLineItems).where(eq(erpPoLineItems.purchaseOrderId, purchaseOrderId));
      await db.delete(erpPurchaseOrders).where(eq(erpPurchaseOrders.id, purchaseOrderId));
    }
    await db.delete(inventoryMovements).where(eq(inventoryMovements.itemId, itemId));
    await db.delete(inventoryStock).where(eq(inventoryStock.itemId, itemId));
    await db.delete(inventoryItems).where(eq(inventoryItems.id, itemId));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(suppliers).where(eq(suppliers.id, supplierId));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, tenantId));

    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it("quality (read-only in the matrix) cannot create a work order", async () => {
    const res = await request(app).post("/work-orders").set("Authorization", `Bearer ${qualityToken}`).send({ itemId, quantityPlanned: 10 });
    expect(res.status).toBe(403);
  });

  it("quality can still read work orders", async () => {
    const res = await request(app).get("/work-orders").set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(200);
  });

  // Per explicit user request (2026-09-15): Customer Service now owns the
  // work order lifecycle; Production was downgraded to read-only (view
  // what's assigned, no longer create/start/complete/cancel).
  it("production (now read-only in the matrix) cannot create a work order", async () => {
    const res = await request(app).post("/work-orders").set("Authorization", `Bearer ${productionToken}`).send({ itemId, quantityPlanned: 10 });
    expect(res.status).toBe(403);
  });

  it("production can still read work orders", async () => {
    const res = await request(app).get("/work-orders").set("Authorization", `Bearer ${productionToken}`);
    expect(res.status).toBe(200);
  });

  it("customer service can create a work order", async () => {
    const res = await request(app).post("/work-orders").set("Authorization", `Bearer ${customerServiceToken}`).send({ itemId, quantityPlanned: 10 });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("planned");
    workOrderId = res.body.id;
  });

  it("quality cannot start it — customer-service-only", async () => {
    const res = await request(app).post(`/work-orders/${workOrderId}/start`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(403);
  });

  it("production cannot start it either — read-only now", async () => {
    const res = await request(app).post(`/work-orders/${workOrderId}/start`).set("Authorization", `Bearer ${productionToken}`);
    expect(res.status).toBe(403);
  });

  it("customer service can start then complete it, which logs a real 'produce' movement", async () => {
    const start = await request(app).post(`/work-orders/${workOrderId}/start`).set("Authorization", `Bearer ${customerServiceToken}`);
    expect(start.status).toBe(200);
    expect(start.body.status).toBe("in_progress");

    const complete = await request(app).post(`/work-orders/${workOrderId}/complete`).set("Authorization", `Bearer ${customerServiceToken}`).send({ quantityCompleted: 10 });
    expect(complete.status).toBe(200);
    expect(complete.body.status).toBe("completed");

    const [movement] = await db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.itemId, itemId));
    expect(movement?.movementType).toBe("produce");
    expect(movement?.referenceType).toBe("work_order");
    expect(movement?.referenceId).toBe(String(workOrderId));
  });

  it("a completed work order cannot be completed again", async () => {
    const res = await request(app).post(`/work-orders/${workOrderId}/complete`).set("Authorization", `Bearer ${customerServiceToken}`).send({ quantityCompleted: 5 });
    expect(res.status).toBe(400);
  });

  it("engineering (no matrix entry for erp at all) can still create its own purchase requisition — a broader gate than 'erp'", async () => {
    const res = await request(app).post("/erp/requisitions").set("Authorization", `Bearer ${engineeringToken}`).send({ itemId, quantity: 25 });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("draft");
    expect(res.body.supplierId).toBe(supplierId); // defaulted from the item's defaultSupplierId
    requisitionId = res.body.id;
  });

  it("engineering can submit its own draft requisition", async () => {
    const res = await request(app).post(`/erp/requisitions/${requisitionId}/submit`).set("Authorization", `Bearer ${engineeringToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending_approval");
  });

  it("engineering cannot approve — purchasing-only", async () => {
    const res = await request(app).post(`/erp/requisitions/${requisitionId}/approve`).set("Authorization", `Bearer ${engineeringToken}`);
    expect(res.status).toBe(403);
  });

  it("purchasing can approve, then convert it to a real Purchase Order", async () => {
    const approve = await request(app).post(`/erp/requisitions/${requisitionId}/approve`).set("Authorization", `Bearer ${purchasingToken}`);
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe("approved");

    const convert = await request(app).post(`/erp/requisitions/${requisitionId}/convert-to-po`).set("Authorization", `Bearer ${purchasingToken}`);
    expect(convert.status).toBe(200);
    expect(convert.body.requisition.status).toBe("converted_to_po");
    expect(convert.body.purchaseOrder.supplierId).toBe(supplierId);
    purchaseOrderId = convert.body.purchaseOrder.id;
  });
});
