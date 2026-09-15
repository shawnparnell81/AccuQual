// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Covers the Production Work Order traveler — the bespoke, standalone
// shop-floor document (deliberately NOT built through the shared FormLayout
// engine, see workOrders.ts's schema comment): the operations routing
// sub-resource (add/edit/sign-off/delete), quality gates, and
// operator/inspector signatures, all gated to production (or admin), and
// all locked once the work order is cancelled — while planning fields
// (quantityPlanned/dueDate/revision) stay locked to "planned" status only,
// the OPPOSITE rule from the traveler fields.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { inventoryItems } from "../../src/drizzle/schema/inventory.js";
import { workOrders, workOrderOperations } from "../../src/drizzle/schema/workOrders.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
let itemId: number;
let workOrderId: number;
let operationId: number;
const userIds: number[] = [];

let productionToken: string;
let qualityToken: string;

async function makeUser(department: string | null, roleName = "operator") {
  const [user] = await db.insert(users).values({ tenantId, email: `wot-test-${department ?? "none"}-${suffix}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName, department });
}

describe("Production Work Order traveler (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `WO Traveler Test Tenant ${suffix}`, code: `wot-test-${suffix}` }).returning();
    tenantId = tenant!.id;

    const [item] = await db.insert(inventoryItems).values({ tenantId, sku: `WOT-${suffix}`, minLevel: "0" }).returning();
    itemId = item!.id;

    productionToken = await makeUser("production");
    qualityToken = await makeUser("quality"); // read-only per PERMISSION_MATRIX.work_orders

    const [wo] = await db.insert(workOrders).values({ tenantId, itemId, quantityPlanned: "100" }).returning();
    workOrderId = wo!.id;
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(inArray(auditTrail.performedBy, userIds));
    await db.delete(workOrderOperations).where(eq(workOrderOperations.workOrderId, workOrderId));
    await db.delete(workOrders).where(eq(workOrders.id, workOrderId));
    await db.delete(inventoryItems).where(eq(inventoryItems.id, itemId));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it("quality (read-only) cannot add an operation", async () => {
    const res = await request(app).post(`/work-orders/${workOrderId}/operations`).set("Authorization", `Bearer ${qualityToken}`).send({ opNumber: 10, description: "Material Prep / Cutting" });
    expect(res.status).toBe(403);
  });

  it("production can add operations to the routing table", async () => {
    const res = await request(app)
      .post(`/work-orders/${workOrderId}/operations`)
      .set("Authorization", `Bearer ${productionToken}`)
      .send({ opNumber: 10, description: "Material Prep / Cutting", workCenter: "Saw Station 02" });
    expect(res.status).toBe(201);
    expect(res.body.opNumber).toBe(10);
    operationId = res.body.id;

    const second = await request(app)
      .post(`/work-orders/${workOrderId}/operations`)
      .set("Authorization", `Bearer ${productionToken}`)
      .send({ opNumber: 20, description: "CNC Rough & Finish Milling", workCenter: "Haas VMC #4" });
    expect(second.status).toBe(201);

    const [row] = await db.select().from(auditTrail).where(eq(auditTrail.entityType, "WorkOrder"));
    expect(row).toBeTruthy();
  });

  it("the detail endpoint returns operations sorted by opNumber", async () => {
    const res = await request(app).get(`/work-orders/${workOrderId}`).set("Authorization", `Bearer ${productionToken}`);
    expect(res.status).toBe(200);
    expect(res.body.operations.map((o: { opNumber: number }) => o.opNumber)).toEqual([10, 20]);
  });

  it("signing off an operation server-stamps signOffDate — never client-supplied", async () => {
    const res = await request(app)
      .patch(`/work-orders/${workOrderId}/operations/${operationId}`)
      .set("Authorization", `Bearer ${productionToken}`)
      .send({ signOff: "J. Alvarez", completedQty: 100 });
    expect(res.status).toBe(200);
    expect(res.body.signOff).toBe("J. Alvarez");
    expect(res.body.signOffDate).toBeTruthy();
  });

  it("re-editing a signed operation's other fields does not clear or re-stamp its signOffDate", async () => {
    const first = await request(app).get(`/work-orders/${workOrderId}`).set("Authorization", `Bearer ${productionToken}`);
    const firstStamp = first.body.operations.find((o: { id: number }) => o.id === operationId).signOffDate;

    const res = await request(app).patch(`/work-orders/${workOrderId}/operations/${operationId}`).set("Authorization", `Bearer ${productionToken}`).send({ workCenter: "Saw Station 03" });
    expect(res.status).toBe(200);
    expect(res.body.signOffDate).toBe(firstStamp);
  });

  it("toggles the quality gates", async () => {
    const res = await request(app).patch(`/work-orders/${workOrderId}/quality-gates`).set("Authorization", `Bearer ${productionToken}`).send({ firstPieceInspectionPassed: true });
    expect(res.status).toBe(200);
    expect(res.body.firstPieceInspectionPassed).toBe(true);
    expect(res.body.finalQcInspectionPassed).toBe(false);
  });

  it("records the operator and inspector signatures with a real server timestamp", async () => {
    const op = await request(app).post(`/work-orders/${workOrderId}/sign-operator`).set("Authorization", `Bearer ${productionToken}`).send({ signature: "T. Nakamura" });
    expect(op.status).toBe(200);
    expect(op.body.operatorSignature).toBe("T. Nakamura");
    expect(op.body.operatorSignedAt).toBeTruthy();

    const insp = await request(app).post(`/work-orders/${workOrderId}/sign-inspector`).set("Authorization", `Bearer ${productionToken}`).send({ signature: "R. Chen" });
    expect(insp.status).toBe(200);
    expect(insp.body.inspectorSignature).toBe("R. Chen");
    expect(insp.body.inspectorSignedAt).toBeTruthy();
  });

  it("planning fields (revision) are rejected once the work order is no longer planned, but traveler fields stay open", async () => {
    const start = await request(app).post(`/work-orders/${workOrderId}/start`).set("Authorization", `Bearer ${productionToken}`);
    expect(start.status).toBe(200);
    expect(start.body.status).toBe("in_progress");

    const revisionAttempt = await request(app).patch(`/work-orders/${workOrderId}`).set("Authorization", `Bearer ${productionToken}`).send({ revision: "REV B" });
    expect(revisionAttempt.status).toBe(400);

    // Still in_progress — the traveler itself (operations/quality gates/signatures) must stay editable.
    const gateAttempt = await request(app).patch(`/work-orders/${workOrderId}/quality-gates`).set("Authorization", `Bearer ${productionToken}`).send({ finalQcInspectionPassed: true });
    expect(gateAttempt.status).toBe(200);
    expect(gateAttempt.body.finalQcInspectionPassed).toBe(true);

    const addOpAttempt = await request(app).post(`/work-orders/${workOrderId}/operations`).set("Authorization", `Bearer ${productionToken}`).send({ opNumber: 30, description: "Deburr & Surface Wash" });
    expect(addOpAttempt.status).toBe(201);
  });

  it("removes an operation", async () => {
    const res = await request(app).delete(`/work-orders/${workOrderId}/operations/${operationId}`).set("Authorization", `Bearer ${productionToken}`);
    expect(res.status).toBe(204);

    const [gone] = await db.select().from(workOrderOperations).where(eq(workOrderOperations.id, operationId));
    expect(gone).toBeUndefined();
  });

  it("cancelling locks the traveler — no more operation edits, quality gate toggles, or signatures", async () => {
    const cancel = await request(app).post(`/work-orders/${workOrderId}/cancel`).set("Authorization", `Bearer ${productionToken}`);
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe("cancelled");

    const gateAttempt = await request(app).patch(`/work-orders/${workOrderId}/quality-gates`).set("Authorization", `Bearer ${productionToken}`).send({ firstPieceInspectionPassed: false });
    expect(gateAttempt.status).toBe(400);

    const signAttempt = await request(app).post(`/work-orders/${workOrderId}/sign-operator`).set("Authorization", `Bearer ${productionToken}`).send({ signature: "Someone Else" });
    expect(signAttempt.status).toBe(400);

    const addOpAttempt = await request(app).post(`/work-orders/${workOrderId}/operations`).set("Authorization", `Bearer ${productionToken}`).send({ opNumber: 40, description: "Final Quality Inspection" });
    expect(addOpAttempt.status).toBe(400);
  });
});
