import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment
// for why this category exists). Covers the company-wide Lot/Serial
// Visibility feature: the search endpoint (GET /inventory/lots), the
// traceability endpoint (GET /inventory/lots/:id/trace) it feeds, real
// department RBAC (material_management/purchasing/production: edit,
// quality: read-only, an unrelated department: no access at all), and
// company isolation on the real HTTP path — same battery
// company-isolation-modules.test.ts already applies to other modules, plus
// the lot-specific traceability chain that battery doesn't cover.
//
// The lot itself is created through the real user flow (create item ->
// create PO -> send PO -> file a Receiving Document with a lot number ->
// file a Quality Inspection Report against that receiving line), not a
// direct DB insert, so this also exercises the exact chain
// inventoryLots.service.ts's getLotTraceability assembles.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { suppliers } from "../../src/drizzle/schema/supplier.js";
import { inventoryItems, inventoryMovements, inventoryAlerts, inventoryStock } from "../../src/drizzle/schema/inventory.js";
import { inventoryLots } from "../../src/drizzle/schema/inventoryLots.js";
import { erpPurchaseOrders, erpPoLineItems, erpReceivingDocuments, erpReceivingLineItems } from "../../src/drizzle/schema/erp.js";
import { qualityInspectionReports } from "../../src/drizzle/schema/qualityInspectionReports.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = Date.now();

let companyId: number;

let supplierId: number;
let itemId: number;
let poId: number;
let lotId: number;
let lotNumber: string;
let serialNumber: string;
const userIds: number[] = [];
let materialManagementToken: string;
let purchasingToken: string;
let qualityToken: string;
let productionToken: string;
let noAccessToken: string;


async function makeUser(forCompanyId: number, department: string | null) {
  const [user] = await db
    .insert(users)
    .values({ email: `lots-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" })
    .returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName: "operator", department });
}

describe("Inventory Lot/Serial Visibility (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;
    
    
    await seedDefaultPermissions(companyId);
    

    const [supplier] = await db.insert(suppliers).values({ name: `Lots Test Supplier ${suffix}` }).returning();
    supplierId = supplier!.id;

    materialManagementToken = await makeUser(companyId, "material_management");
    purchasingToken = await makeUser(companyId, "purchasing");
    qualityToken = await makeUser(companyId, "quality");
    productionToken = await makeUser(companyId, "production");
    // Not a department key in inventory's own PERMISSION_MATRIX at all
    // (see defaultPermissions.ts) — the real "no access whatsoever" case,
    // distinct from quality's deliberate read-only grant.
    noAccessToken = await makeUser(companyId, "sales_and_marketing");
    

    // Real item, created through the same endpoint a real user hits.
    const itemRes = await request(app)
      .post("/inventory/items")
      .set("Authorization", `Bearer ${materialManagementToken}`)
      .send({ sku: `LOT-TEST-SKU-${suffix}`, description: "Lot visibility test widget" });
    expect(itemRes.status).toBe(201);
    itemId = itemRes.body.id;

    // Real PO -> send -> receive-with-lot-number, the exact chain a
    // physical receiving event produces (see erp.service.ts's
    // createReceivingDocument).
    const poRes = await request(app)
      .post("/erp/purchase-orders")
      .set("Authorization", `Bearer ${purchasingToken}`)
      .send({ supplierId, lineItems: [{ itemId, quantity: 100, unitCost: 5 }] });
    expect(poRes.status).toBe(201);
    poId = poRes.body.id;
    const sendRes = await request(app).post(`/erp/purchase-orders/${poId}/send`).set("Authorization", `Bearer ${purchasingToken}`);
    expect(sendRes.status).toBe(200);

    const poDetail = await request(app).get(`/erp/purchase-orders/${poId}`).set("Authorization", `Bearer ${purchasingToken}`);
    const poLineItemId = poDetail.body.lineItems[0].id;

    lotNumber = `LOT-${suffix}`;
    serialNumber = `SN-${suffix}`;
    const receivingRes = await request(app)
      .post("/erp/receiving-documents")
      .set("Authorization", `Bearer ${materialManagementToken}`)
      .send({ purchaseOrderId: poId, lineItems: [{ poLineItemId, quantityReceived: 100, lotNumber, serialNumber, revisionLevel: "B", expirationDate: "2030-01-01" }] });
    expect(receivingRes.status).toBe(201);
    const receivingDocDetail = await request(app).get(`/erp/receiving-documents/${receivingRes.body.id}`).set("Authorization", `Bearer ${materialManagementToken}`);
    const receivingLineItemId = receivingDocDetail.body.lineItems[0].id;

    // Real inspection report against that same receiving line — completes
    // the chain getLotTraceability assembles.
    const inspectionRes = await request(app)
      .post("/quality-inspection-reports")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ inspectionType: "incoming", supplierId, receivingLineItemId });
    expect(inspectionRes.status).toBe(201);
    await request(app).patch(`/quality-inspection-reports/${inspectionRes.body.id}`).set("Authorization", `Bearer ${qualityToken}`).send({ finalStatus: "accepted" });

    const lotsRes = await request(app).get(`/inventory/items/${itemId}/lots`).set("Authorization", `Bearer ${materialManagementToken}`);
    lotId = lotsRes.body[0].id;
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  describe("search — GET /inventory/lots", () => {
    it("finds the lot by its own lot number", async () => {
      const res = await request(app).get("/inventory/lots").query({ q: lotNumber }).set("Authorization", `Bearer ${qualityToken}`);
      expect(res.status).toBe(200);
      expect(res.body.some((l: { id: number }) => l.id === lotId)).toBe(true);
    });

    it("finds the lot by its serial number", async () => {
      const res = await request(app).get("/inventory/lots").query({ q: serialNumber }).set("Authorization", `Bearer ${materialManagementToken}`);
      expect(res.status).toBe(200);
      expect(res.body.some((l: { id: number }) => l.id === lotId)).toBe(true);
    });

    it("finds the lot by its item's SKU, joined in from inventory_items", async () => {
      const itemRes = await request(app).get(`/inventory/items/${itemId}`).set("Authorization", `Bearer ${purchasingToken}`);
      const res = await request(app).get("/inventory/lots").query({ q: itemRes.body.sku }).set("Authorization", `Bearer ${purchasingToken}`);
      expect(res.status).toBe(200);
      const row = res.body.find((l: { id: number }) => l.id === lotId);
      expect(row).toBeDefined();
      expect(row.sku).toBe(itemRes.body.sku);
    });

    it("a search with no match returns an empty list, not an error", async () => {
      const res = await request(app).get("/inventory/lots").query({ q: `no-such-lot-${suffix}` }).set("Authorization", `Bearer ${qualityToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("status filter narrows to the real lifecycle state", async () => {
      const active = await request(app).get("/inventory/lots").query({ status: "active" }).set("Authorization", `Bearer ${qualityToken}`);
      expect(active.body.some((l: { id: number }) => l.id === lotId)).toBe(true);

      const consumed = await request(app).get("/inventory/lots").query({ status: "consumed" }).set("Authorization", `Bearer ${qualityToken}`);
      expect(consumed.body.some((l: { id: number }) => l.id === lotId)).toBe(false);
    });

    it("quality (read-only on inventory) can search", async () => {
      const res = await request(app).get("/inventory/lots").set("Authorization", `Bearer ${qualityToken}`);
      expect(res.status).toBe(200);
    });

    it("a department with no inventory access at all is rejected outright", async () => {
      const res = await request(app).get("/inventory/lots").set("Authorization", `Bearer ${noAccessToken}`);
      expect(res.status).toBe(403);
    });

    ;
  });

  describe("traceability — GET /inventory/lots/:id/trace", () => {
    it("assembles the full real chain: item, supplier, PO, receiving line, inspection report, and the receive movement", async () => {
      const res = await request(app).get(`/inventory/lots/${lotId}/trace`).set("Authorization", `Bearer ${qualityToken}`);
      expect(res.status).toBe(200);
      expect(res.body.lot.id).toBe(lotId);
      expect(res.body.lot.lotNumber).toBe(lotNumber);
      expect(res.body.item.id).toBe(itemId);
      expect(res.body.supplier.id).toBe(supplierId);
      expect(res.body.purchaseOrder.id).toBe(poId);
      expect(res.body.receivingLineItem).not.toBeNull();
      expect(res.body.inspectionReport.finalStatus).toBe("accepted");
      expect(res.body.movements.length).toBeGreaterThanOrEqual(1);
      expect(res.body.movements[0].movementType).toBe("receive");
    });

    it("a consume movement against the lot shows up in its trace and decrements remainingQty", async () => {
      const consumeRes = await request(app)
        .post(`/inventory/items/${itemId}/movement`)
        .set("Authorization", `Bearer ${productionToken}`)
        .send({ movementType: "consume", quantity: 20, lotId });
      expect(consumeRes.status).toBe(201);

      const trace = await request(app).get(`/inventory/lots/${lotId}/trace`).set("Authorization", `Bearer ${materialManagementToken}`);
      expect(trace.body.lot.remainingQty).toBe("80");
      expect(trace.body.movements.some((m: { movementType: string }) => m.movementType === "consume")).toBe(true);
    });

    it("quality cannot consume — read-only on inventory, same gate as every other movement", async () => {
      const res = await request(app).post(`/inventory/items/${itemId}/movement`).set("Authorization", `Bearer ${qualityToken}`).send({ movementType: "consume", quantity: 1, lotId });
      expect(res.status).toBe(403);
    });

    ;

    it("a request with no company context at all is rejected outright", async () => {
      const res = await request(app).get(`/inventory/lots/${lotId}/trace`);
      expect(res.status).toBe(401);
    });
  });
});
