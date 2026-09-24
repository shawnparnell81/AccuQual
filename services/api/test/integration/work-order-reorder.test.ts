// Real-DB integration test (see tenant-isolation.test.ts's header comment).
// Drag-to-reorder for a traveler's operations routing table: existing op numbers are handed to the operations in
// their new order, a signed-off operation can't be moved, a partial/duplicate list is refused, and only Customer
// Service / admin can reorder.
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
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
let itemId: number;
let workOrderId: number;
const userIds: number[] = [];
let csToken: string;
let qualityToken: string;
const opIds: Record<string, number> = {};

async function makeUser(department: string) {
  const [user] = await db.insert(users).values({ tenantId, email: `wo-reorder-${department}-${suffix}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), tenantId, roleId: null, roleName: "operator", department });
}

const reorder = (token: string, ids: number[]) => request(app).post(`/work-orders/${workOrderId}/operations/reorder`).set("Authorization", `Bearer ${token}`).send({ ids });
async function numbers() {
  const rows = await db.select().from(workOrderOperations).where(eq(workOrderOperations.workOrderId, workOrderId));
  return Object.fromEntries(rows.map((r) => [r.description, r.opNumber]));
}

describe("Work order operation reorder (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `WO Reorder ${suffix}`, code: `wo-reorder-${suffix}` }).returning();
    tenantId = tenant!.id;
    await seedDefaultPermissions(tenantId);
    const [item] = await db.insert(inventoryItems).values({ tenantId, sku: `WOR-${suffix}`, minLevel: "0" }).returning();
    itemId = item!.id;
    csToken = await makeUser("customer_service");
    qualityToken = await makeUser("quality");
    const [wo] = await db.insert(workOrders).values({ tenantId, itemId, quantityPlanned: "10" }).returning();
    workOrderId = wo!.id;
    for (const [name, opNumber] of [["Cut", 10], ["Drill", 20], ["Deburr", 30]] as const) {
      const [op] = await db.insert(workOrderOperations).values({ tenantId, workOrderId, opNumber, description: name }).returning();
      opIds[name] = op!.id;
    }
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.delete(auditTrail).where(inArray(auditTrail.performedBy, userIds));
    await db.delete(workOrderOperations).where(eq(workOrderOperations.workOrderId, workOrderId));
    await db.delete(workOrders).where(eq(workOrders.id, workOrderId));
    await db.delete(inventoryItems).where(eq(inventoryItems.id, itemId));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(departmentPermissions).where(eq(departmentPermissions.tenantId, tenantId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await pool.end();
  });

  it("hands the existing op numbers to the operations in their new order, and audits it", async () => {
    const res = await reorder(csToken, [opIds.Deburr!, opIds.Cut!, opIds.Drill!]);
    expect(res.status).toBe(200);
    expect(res.body.map((o: { description: string }) => o.description)).toEqual(["Deburr", "Cut", "Drill"]);
    expect(await numbers()).toEqual({ Deburr: 10, Cut: 20, Drill: 30 });
    const audits = await db.select().from(auditTrail).where(inArray(auditTrail.performedBy, userIds));
    expect(audits.some((a) => (a.changes as { subAction?: string } | null)?.subAction === "operations_reordered")).toBe(true);
  });

  it("refuses an order that doesn't list every operation exactly once", async () => {
    expect((await reorder(csToken, [opIds.Cut!, opIds.Drill!])).status).toBe(400);
    expect((await reorder(csToken, [opIds.Cut!, opIds.Cut!, opIds.Drill!])).status).toBe(400);
    expect((await reorder(csToken, [opIds.Cut!, opIds.Drill!, 999999999])).status).toBe(400);
  });

  it("won't move an operation that is already signed off", async () => {
    await request(app).patch(`/work-orders/${workOrderId}/operations/${opIds.Deburr}`).set("Authorization", `Bearer ${csToken}`).send({ signOff: "T. Nakamura" });
    // Deburr now sits at op 10; putting it anywhere else would move it.
    const moveIt = await reorder(csToken, [opIds.Cut!, opIds.Deburr!, opIds.Drill!]);
    expect(moveIt.status).toBe(400);
    expect(moveIt.body.message).toMatch(/signed off/i);
    expect(await numbers()).toEqual({ Deburr: 10, Cut: 20, Drill: 30 });
    // Reordering only the unsigned ones, leaving the signed operation in place, is fine.
    const ok = await reorder(csToken, [opIds.Deburr!, opIds.Drill!, opIds.Cut!]);
    expect(ok.status).toBe(200);
    expect(await numbers()).toEqual({ Deburr: 10, Drill: 20, Cut: 30 });
  });

  it("only Customer Service (or admin) can reorder", async () => {
    expect((await reorder(qualityToken, [opIds.Deburr!, opIds.Cut!, opIds.Drill!])).status).toBe(403);
  });
});
