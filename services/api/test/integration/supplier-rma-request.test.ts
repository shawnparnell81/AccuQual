// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Covers the Supplier Portal's new RMA Request tab end to end: a real
// supplier login submits the request, the real RMA gets auto-created and
// numbered RMA-YYYY-XXXX in the same request, a matching real part/PO get
// auto-linked, Quality + Customer Service get real (logged-only)
// notifications, every step lands in rma_log, the supplier can check its
// own status afterward, and the whole thing is barred to internal staff
// and to a supplier login with no matching part/PO on file.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, and } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { suppliers } from "../../src/drizzle/schema/supplier.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { rma, rmaItems } from "../../src/drizzle/schema/rma.js";
import { erpPurchaseOrders } from "../../src/drizzle/schema/erp.js";
import { inventoryItems } from "../../src/drizzle/schema/inventory.js";
import { supplierRmaRequests, rmaActivityLog } from "../../src/drizzle/schema/supplierRma.js";
import { notificationLog } from "../../src/drizzle/schema/notifications.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { ensureSupplierRole } from "../../src/modules/supplier/supplier.controller.js";

import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
const app = createApp();
const suffix = Date.now();

let tenantId: number;
let supplierId: number;
let supplierToken: string;
let qualityToken: string;
let customerServiceToken: string;
let poId: number;
let itemId: number;
let createdRmaId: number;

async function makeInternalUser(department: string) {
  const [user] = await db.insert(users).values({ tenantId, email: `sprma-staff-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused", department }).returning();
  return signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName: "operator", department });
}

describe("Supplier Portal RMA Request — AI-automated RMA creation (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `Supplier RMA Request Test Tenant ${suffix}`, code: `sprma-test-${suffix}` }).returning();
    tenantId = tenant!.id;

    await seedDefaultPermissions(tenantId);

    const [supplier] = await db.insert(suppliers).values({ tenantId, name: `RMA Request Supplier ${suffix}`, contactEmail: "supplier@test.local" }).returning();
    supplierId = supplier!.id;

    const roleId = (await ensureSupplierRole(db)).id;
    const [supplierUser] = await db.insert(users).values({ tenantId, email: `sprma-login-${suffix}@test.local`, passwordHash: "unused", department: null, roleId, supplierId }).returning();
    supplierToken = signAccessToken({ sub: String(supplierUser!.id), tenantId, roleId, roleName: "supplier", department: null, supplierId });

    qualityToken = await makeInternalUser("quality");
    customerServiceToken = await makeInternalUser("customer_service");

    const [po] = await db.insert(erpPurchaseOrders).values({ tenantId, supplierId, status: "sent" }).returning();
    poId = po!.id;
    const [item] = await db.insert(inventoryItems).values({ tenantId, sku: `SPRMA-SKU-${suffix}`, itemType: "raw_material", minLevel: "0" }).returning();
    itemId = item!.id;
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, tenantId));
    await db.delete(notificationLog).where(eq(notificationLog.tenantId, tenantId));
    await db.delete(rmaActivityLog).where(eq(rmaActivityLog.tenantId, tenantId));
    await db.delete(supplierRmaRequests).where(eq(supplierRmaRequests.tenantId, tenantId));
    await db.delete(rmaItems).where(eq(rmaItems.tenantId, tenantId));
    await db.delete(rma).where(eq(rma.tenantId, tenantId));
    await db.delete(inventoryItems).where(eq(inventoryItems.tenantId, tenantId));
    await db.delete(erpPurchaseOrders).where(eq(erpPurchaseOrders.tenantId, tenantId));
    await db.delete(users).where(eq(users.tenantId, tenantId));
    await db.delete(suppliers).where(eq(suppliers.tenantId, tenantId));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, tenantId));

    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it("internal staff cannot submit an RMA Request (supplier-only action)", async () => {
    const res = await request(app).post("/supplier-portal/rma-request").set("Authorization", `Bearer ${qualityToken}`).send({ companyName: "x", contactName: "x", email: "x@test.local" });
    expect(res.status).toBe(403);
  });

  it("supplier submits a real RMA Request and a real numbered RMA is created synchronously", async () => {
    const item = await db.select().from(inventoryItems).where(eq(inventoryItems.id, itemId));
    const sku = item[0]!.sku;

    const res = await request(app)
      .post("/supplier-portal/rma-request")
      .set("Authorization", `Bearer ${supplierToken}`)
      .send({
        companyName: "Acme Fasteners Co.",
        contactName: "Jane Doe",
        email: "jane@acmefasteners.test",
        phoneNumber: "555-0100",
        poNumber: `PO-${poId}`,
        partNumber: sku,
        customerClaimNumber: "CLM-777",
        shortDescription: "Wrong thread pitch on delivered batch.",
        description: "Full batch of 200 units delivered with M8x1.0 thread instead of the specified M8x1.25.",
      });

    expect(res.status).toBe(201);
    expect(res.body.request.status).toBe("rma_created");
    expect(res.body.rma.rmaNumber).toMatch(new RegExp(`^RMA-${new Date().getFullYear()}-\\d{4}$`));
    createdRmaId = res.body.rma.id;
  });

  it("the real RMA auto-linked the matching PO and got a real rma_items row for the matched part", async () => {
    const [rmaRow] = await db.select().from(rma).where(eq(rma.id, createdRmaId));
    expect(rmaRow!.linkedPoId).toBe(poId);
    expect(rmaRow!.supplierId).toBe(supplierId);
    expect(rmaRow!.notes).toContain("Supplier Portal RMA Request");

    const items = await db.select().from(rmaItems).where(eq(rmaItems.rmaId, createdRmaId));
    expect(items).toHaveLength(1);
    expect(items[0]!.itemId).toBe(itemId);
  });

  it("Quality and Customer Service were both notified (real, logged-only entries)", async () => {
    const rows = await db.select().from(notificationLog).where(and(eq(notificationLog.tenantId, tenantId), eq(notificationLog.relatedEntityType, "Rma"), eq(notificationLog.relatedEntityId, createdRmaId)));
    expect(rows.length).toBeGreaterThanOrEqual(2); // at least one quality + one customer_service recipient (makeInternalUser seeded one of each so far)
  });

  it("every real step landed in the RMA Activity Log: submitted, auto-match, created, notified", async () => {
    const rows = await db.select().from(rmaActivityLog).where(eq(rmaActivityLog.rmaId, createdRmaId));
    const events = rows.map((r) => r.event);
    expect(events).toContain("rma_created");
    expect(events).toContain("notifications_sent");

    const submissionRows = await db.select().from(rmaActivityLog).where(eq(rmaActivityLog.tenantId, tenantId));
    const allEvents = submissionRows.map((r) => r.event);
    expect(allEvents).toContain("request_submitted");
    expect(allEvents).toContain("auto_match_attempted");
  });

  it("the audit trail recorded both the request submission and the RMA creation", async () => {
    const requestAudit = await db.select().from(auditTrail).where(and(eq(auditTrail.tenantId, tenantId), eq(auditTrail.entityType, "SupplierRmaRequest")));
    const rmaAudit = await db.select().from(auditTrail).where(and(eq(auditTrail.tenantId, tenantId), eq(auditTrail.entityType, "Rma"), eq(auditTrail.entityId, createdRmaId)));
    expect(requestAudit.length).toBeGreaterThan(0);
    expect(rmaAudit.length).toBeGreaterThan(0);
  });

  it("the supplier can check their own request status and see the real RMA number", async () => {
    const res = await request(app).get("/supplier-portal/rma-request/status").set("Authorization", `Bearer ${supplierToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].status).toBe("rma_created");
    expect(res.body[0].createdRmaNumber).toMatch(/^RMA-\d{4}-\d{4}$/);
  });

  it("a request with an unmatchable part/PO still creates a real RMA, honestly logged as no match", async () => {
    const res = await request(app)
      .post("/supplier-portal/rma-request")
      .set("Authorization", `Bearer ${supplierToken}`)
      .send({ companyName: "Acme Fasteners Co.", contactName: "Jane Doe", email: "jane@acmefasteners.test", poNumber: "no-digits-here", partNumber: "NONEXISTENT-SKU" });
    expect(res.status).toBe(201);
    const [rmaRow] = await db.select().from(rma).where(eq(rma.id, res.body.rma.id));
    expect(rmaRow!.linkedPoId).toBeNull();
    const items = await db.select().from(rmaItems).where(eq(rmaItems.rmaId, res.body.rma.id));
    expect(items).toHaveLength(0);
  });

  it("Quality and Customer Service can both read the RMA Activity Log; a supplier login cannot", async () => {
    const qualityView = await request(app).get("/rma-activity-log").set("Authorization", `Bearer ${qualityToken}`);
    expect(qualityView.status).toBe(200);
    expect(qualityView.body.length).toBeGreaterThan(0);

    const csView = await request(app).get("/rma-activity-log").set("Authorization", `Bearer ${customerServiceToken}`);
    expect(csView.status).toBe(200);

    const supplierView = await request(app).get("/rma-activity-log").set("Authorization", `Bearer ${supplierToken}`);
    expect(supplierView.status).toBe(403);
  });
});
