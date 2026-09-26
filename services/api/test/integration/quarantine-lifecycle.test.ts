import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Quarantine through its real HTTP endpoints: a hold that really stops inventory being issued / consumed / reserved / scrapped,
// partial release and destroy, four-eyes, locations, records that are not enforced, the receiving hook, RBAC, isolation, audit.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { roles } from "../../src/drizzle/schema/roles.js";
import { suppliers } from "../../src/drizzle/schema/supplier.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { inventoryItems, inventoryStock, inventoryMovements, inventoryAlerts } from "../../src/drizzle/schema/inventory.js";
import { inventoryLots } from "../../src/drizzle/schema/inventoryLots.js";
import { erpPurchaseOrders, erpPoLineItems, erpReceivingDocuments, erpReceivingLineItems } from "../../src/drizzle/schema/erp.js";
import { quarantineRecords, quarantineInventory, quarantineResolutions } from "../../src/drizzle/schema/quarantine.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { auditRowChanges } from "../../src/drizzle/schema/auditRowChanges.js";
import { notificationLog } from "../../src/drizzle/schema/notifications.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { applyMovement } from "../../src/modules/inventory/inventory.service.js";

const app = createApp();
const suffix = Date.now();

let companyId: number;

const userIds: number[] = [];
type Who = { id: number; email: string; token: string };
let qualityUser: Who; // quality department, ordinary role: can place and move holds, cannot release
let manager: Who; // quality department, quality_manager: may release / destroy
let admin: Who;
let production: Who; // read on quarantine, edit on inventory
let sales: Who; // no access to quarantine at all
let customer: Who;

let supplierId: number;

async function makeUser(co: number, label: string, roleName: string, department: string | null): Promise<Who> {
  const email = `quar-${label}-${suffix}@test.local`;
  const [u] = await db.insert(users).values({ email, passwordHash: "unused", department }).returning();
  userIds.push(u!.id);
  return { id: u!.id, email, token: await signAccessToken({ sub: String(u!.id), roleId: null, roleName, department }) };
}
const as = (w: Who) => ({ Authorization: `Bearer ${w.token}` });

const events = async (id: number) => (await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "Quarantine"), eq(auditTrail.entityId, id)))).map((r) => r.changes as Record<string, unknown> | null);
const hasEvent = async (id: number, event: string) => (await events(id)).some((c) => c?.event === event);

/** An inventory item with `qty` in stock and one lot holding all of it — the shape a real receipt leaves behind. */
async function stockedLot(qty: number, sku = `Q-${Math.random().toString(36).slice(2, 8)}`) {
  const [item] = await db.insert(inventoryItems).values({ sku, description: "Quarantine test part", unitOfMeasure: "pcs" }).returning();
  await applyMovement(db, item!.id, { movementType: "receive", quantity: qty }, undefined);
  const [lot] = await db.insert(inventoryLots).values({ itemId: item!.id, lotNumber: `L-${sku}`, receivedQty: String(qty), remainingQty: String(qty) }).returning();
  return { itemId: item!.id, lotId: lot!.id, sku };
}
const itemRow = async (id: number) => (await db.select().from(inventoryItems).where(eq(inventoryItems.id, id)))[0]!;
const lotRow = async (id: number) => (await db.select().from(inventoryLots).where(eq(inventoryLots.id, id)))[0]!;
const onHand = async (itemId: number) => (await db.select().from(inventoryStock).where(eq(inventoryStock.itemId, itemId))).reduce((s, r) => s + Number(r.onHand), 0);

async function hold(who: Who, body: Record<string, unknown>) {
  return request(app).post("/quarantine").set(as(who)).send({ reasonCategory: "nonconforming_material", reason: "Out of tolerance on incoming inspection", ...body });
}
const consume = (itemId: number, quantity: number, extra: Record<string, unknown> = {}) => request(app).post(`/inventory/items/${itemId}/movement`).set(as(production)).send({ movementType: "consume", quantity, ...extra });

describe("Quarantine (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const t = await ensureTestCompany();
    
    companyId = t!.id;
    
    await seedDefaultPermissions(companyId);
    
    qualityUser = await makeUser(companyId, "quality", "operator", "quality");
    manager = await makeUser(companyId, "manager", "quality_manager", "quality");
    admin = await makeUser(companyId, "admin", "admin", null);
    production = await makeUser(companyId, "production", "operator", "production");
    sales = await makeUser(companyId, "sales", "operator", "sales_and_marketing");
    customer = await makeUser(companyId, "customer", "customer", null);
    
    await db.insert(roles).values([{ name: "quality_manager" }, { name: "admin" }]).onConflictDoNothing();
    // By default Quality has only read access to the ERP area, which the receiving state machine sits behind; this organization grants edit.
    await db.update(departmentPermissions).set({ accessLevel: "edit" }).where(and(eq(departmentPermissions.departmentName, "quality"), eq(departmentPermissions.moduleName, "erp")));
    supplierId = (await db.insert(suppliers).values({ name: `Quar Supplier ${suffix}` }).returning())[0]!.id;
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    for (const t of [companyId]) {
      await db.delete(auditRowChanges);
      await db.delete(auditTrail);
      await db.delete(notificationLog);
      // The decision log is append-only by trigger; this is a test-database teardown, so lift it for the cleanup only.
      await pool.query("ALTER TABLE quarantine_resolutions DISABLE TRIGGER quarantine_resolutions_append_only");
      await db.delete(quarantineResolutions);
      await pool.query("ALTER TABLE quarantine_resolutions ENABLE TRIGGER quarantine_resolutions_append_only");
      await db.delete(quarantineInventory);
      await db.delete(quarantineRecords);
      await db.delete(ncr);
      // Lots point at receiving lines, and movements at lots, so they go first.
      await db.delete(inventoryMovements);
      await db.delete(inventoryAlerts);
      await db.delete(inventoryLots);
      await db.delete(erpReceivingLineItems);
      await db.delete(erpReceivingDocuments);
      await db.delete(erpPoLineItems);
      await db.delete(erpPurchaseOrders);
      await db.delete(inventoryStock);
      await db.delete(inventoryItems);
      await db.delete(suppliers);
      await db.delete(departmentPermissions);
    }
    await pool.end();
  });

  // -------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("a hold on inventory is real", () => {
    let s: { itemId: number; lotId: number; sku: string };
    let qId: number;

    it("puts part of a lot on hold, counts it against the item and the lot, and records where it is", async () => {
      s = await stockedLot(100);
      const res = await hold(qualityUser, { itemType: "inventory_lot", itemId: s.lotId, quantity: 30, location: "Cage A" });
      expect(res.status).toBe(201);
      qId = res.body.id;
      expect(res.body).toMatchObject({ status: "quarantined", enforced: true, itemType: "inventory_lot", lotNumber: `L-${s.sku}`, unit: "pcs", createdBy: qualityUser.id });
      expect(Number(res.body.quantity)).toBe(30);
      expect(Number((await itemRow(s.itemId)).heldQty)).toBe(30);
      expect(Number((await lotRow(s.lotId)).heldQty)).toBe(30);
      const inv = await db.select().from(quarantineInventory).where(eq(quarantineInventory.quarantineId, qId));
      expect(inv.map((r) => [r.location, Number(r.quantity)])).toEqual([["Cage A", 30]]);
      expect(await hasEvent(qId, "quarantine_created")).toBe(true);
    });

    it("won't hold more than is there to hold", async () => {
      const res = await hold(qualityUser, { itemType: "inventory_lot", itemId: s.lotId, quantity: 80 });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/70/);
    });

    it("stops the held units being consumed, while the rest can still be used", async () => {
      const tooMany = await consume(s.itemId, 80);
      expect(tooMany.status).toBe(409);
      expect(tooMany.body.message).toMatch(/quarantine hold/i);
      expect(await onHand(s.itemId)).toBe(100); // nothing moved
      const ok = await consume(s.itemId, 70);
      expect(ok.status).toBe(201);
      expect(await onHand(s.itemId)).toBe(30);
      expect((await consume(s.itemId, 1)).status).toBe(409); // only the held 30 are left
    });

    it("keeps holding when the caller names the lot, and can't be talked around", async () => {
      const s2 = await stockedLot(50);
      await hold(qualityUser, { itemType: "inventory_lot", itemId: s2.lotId, quantity: 20 });
      const byLot = await consume(s2.itemId, 40, { lotId: s2.lotId });
      expect(byLot.status).toBe(409);
      expect(byLot.body.message).toMatch(/quarantine hold/i);
      expect((await consume(s2.itemId, 40, { lotId: s2.lotId, allowHeld: true, bypassHold: true })).status).toBe(409); // unknown keys change nothing
      expect((await consume(s2.itemId, 30, { lotId: s2.lotId })).status).toBe(201);
      expect(Number((await lotRow(s2.lotId)).remainingQty)).toBe(20);
    });

    it("stops a manual scrap or return of held units too — they leave only through a quarantine decision", async () => {
      const s3 = await stockedLot(40);
      await hold(qualityUser, { itemType: "inventory_lot", itemId: s3.lotId, quantity: 40 });
      for (const movementType of ["scrap", "return", "consume"]) {
        const res = await request(app).post(`/inventory/items/${s3.itemId}/movement`).set(as(production)).send({ movementType, quantity: 5, reason: "test" });
        expect(res.status, movementType).toBe(409);
      }
      expect(await onHand(s3.itemId)).toBe(40);
    });

    it("keeps held units out of reservations", async () => {
      const s4 = await stockedLot(10);
      await hold(qualityUser, { itemType: "inventory_item", itemId: s4.itemId, quantity: 8 });
      const res = await request(app).post(`/inventory/items/${s4.itemId}/reserve`).set(as(production)).send({ quantity: 5 });
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/quarantine hold/i);
      expect((await request(app).post(`/inventory/items/${s4.itemId}/reserve`).set(as(production)).send({ quantity: 2 })).status).toBeLessThan(300);
    });
  });

  // -------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("deciding what happens", () => {
    let s: { itemId: number; lotId: number; sku: string };
    let qId: number;

    it("won't let the person who placed a hold decide it (an admin excepted), or anyone without reviewing rights", async () => {
      s = await stockedLot(100);
      const created = await hold(manager, { itemType: "inventory_lot", itemId: s.lotId, quantity: 60, location: "Cage A" });
      qId = created.body.id;
      const self = await request(app).post(`/quarantine/${qId}/release`).set(as(manager)).send({ disposition: "use_as_is", notes: "Checked and fine" });
      expect(self.status).toBe(403);
      expect(self.body.message).toMatch(/someone else/i);
      const editor = await request(app).post(`/quarantine/${qId}/release`).set(as(qualityUser)).send({ disposition: "use_as_is", notes: "Checked and fine" });
      expect(editor.status).toBe(403);
      expect((await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "Quarantine")))).some((r) => (r.changes as { permission?: string } | null)?.permission === "quarantine.release")).toBe(true);
      expect(Number((await lotRow(s.lotId)).heldQty)).toBe(60); // nothing changed
    });

    it("checks the decision itself: a listed disposition, a written reason, a sensible quantity", async () => {
      const q = await hold(qualityUser, { itemType: "inventory_lot", itemId: (await stockedLot(20)).lotId, quantity: 10 });
      const id = q.body.id;
      expect((await request(app).post(`/quarantine/${id}/release`).set(as(manager)).send({ disposition: "scrapped", notes: "Wrong kind" })).status).toBe(400); // scrapped is a destroy
      expect((await request(app).post(`/quarantine/${id}/destroy`).set(as(manager)).send({ disposition: "use_as_is", notes: "Wrong kind" })).status).toBe(400);
      expect((await request(app).post(`/quarantine/${id}/release`).set(as(manager)).send({ disposition: "use_as_is", notes: "ok" })).status).toBe(400); // too short
      expect((await request(app).post(`/quarantine/${id}/release`).set(as(manager)).send({ disposition: "use_as_is", notes: "Checked", quantity: 11 })).status).toBe(400);
    });

    it("releases part of a hold: those units are usable again and the rest stay held", async () => {
      const res = await request(app).post(`/quarantine/${qId}/release`).set(as(admin)).send({ disposition: "sorted", quantity: 20, notes: "Sorted 20 good pieces from the lot" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "quarantined" });
      expect(Number(res.body.quantity)).toBe(40);
      expect(res.body.resolutions).toHaveLength(1);
      expect(res.body.resolutions[0]).toMatchObject({ action: "release", disposition: "sorted", resolvedBy: admin.id });
      expect(Number((await itemRow(s.itemId)).heldQty)).toBe(40);
      expect(Number((await lotRow(s.lotId)).heldQty)).toBe(40);
      expect(res.body.inventory.map((r: { quantity: string }) => Number(r.quantity))).toEqual([40]);
      expect((await consume(s.itemId, 60)).status).toBe(201); // 100 - 40 held
      expect(await hasEvent(qId, "quarantine_released")).toBe(true);
    });

    it("destroys the rest: the units leave stock through a recorded scrap, the hold ends, and the record closes", async () => {
      const before = await onHand(s.itemId); // 40, all held
      const res = await request(app).post(`/quarantine/${qId}/destroy`).set(as(admin)).send({ disposition: "scrapped", notes: "Failed the fit check, scrapped" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "released" }); // some was released earlier, so the record ends as released
      expect(Number(res.body.quantity)).toBe(0);
      expect(res.body.resolutions.map((r: { action: string }) => r.action)).toEqual(["release", "destroy"]);
      expect(await onHand(s.itemId)).toBe(before - 40);
      expect(Number((await itemRow(s.itemId)).heldQty)).toBe(0);
      expect(Number((await lotRow(s.lotId)).heldQty)).toBe(0);
      const scrap = (await db.select().from(inventoryMovements).where(and(eq(inventoryMovements.itemId, s.itemId), eq(inventoryMovements.movementType, "scrap"))))[0];
      expect(scrap).toMatchObject({ referenceType: "quarantine", referenceId: String(qId) });
      expect((await request(app).post(`/quarantine/${qId}/release`).set(as(admin)).send({ disposition: "use_as_is", notes: "Too late now" })).status).toBe(409);
      expect((await request(app).patch(`/quarantine/${qId}`).set(as(qualityUser)).send({ reason: "Changing history" })).status).toBe(409);
    });

    it("ends as destroyed when nothing was ever released, and can send units back to the supplier", async () => {
      const a = await stockedLot(30);
      const qa = await hold(qualityUser, { itemType: "inventory_lot", itemId: a.lotId, quantity: 30 });
      const gone = await request(app).post(`/quarantine/${qa.body.id}/destroy`).set(as(manager)).send({ disposition: "returned_to_supplier", notes: "Sent back on RMA 4471" });
      expect(gone.body).toMatchObject({ status: "destroyed" });
      expect(await onHand(a.itemId)).toBe(0);
      const ret = await db.select().from(inventoryMovements).where(and(eq(inventoryMovements.itemId, a.itemId), eq(inventoryMovements.movementType, "return")));
      expect(ret).toHaveLength(1);
    });

    it("keeps its decision log append-only, in the database itself", async () => {
      const [row] = await db.select().from(quarantineResolutions).where(eq(quarantineResolutions.quarantineId, qId));
      await expect(pool.query(`UPDATE quarantine_resolutions SET notes = 'rewritten' WHERE id = $1`, [row!.id])).rejects.toThrow(/cannot be edited/i);
      await expect(pool.query(`DELETE FROM quarantine_resolutions WHERE id = $1`, [row!.id])).rejects.toThrow(/cannot be edited/i);
      await expect(pool.query(`UPDATE inventory_items SET held_qty = -1 WHERE id = $1`, [s.itemId])).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("locations, holds that aren't enforced, and the dashboard", () => {
    it("moves held quantity between places and lists where everything is", async () => {
      const s = await stockedLot(50);
      const q = await hold(qualityUser, { itemType: "inventory_lot", itemId: s.lotId, quantity: 50, location: "Cage A" });
      const id = q.body.id;
      expect((await request(app).post(`/quarantine/${id}/relocate`).set(as(qualityUser)).send({ fromLocation: "Cage A", toLocation: "Cage B", quantity: 60 })).status).toBe(400);
      expect((await request(app).post(`/quarantine/${id}/relocate`).set(as(qualityUser)).send({ fromLocation: "Cage A", toLocation: "Cage A", quantity: 5 })).status).toBe(400);
      const moved = await request(app).post(`/quarantine/${id}/relocate`).set(as(qualityUser)).send({ fromLocation: "Cage A", toLocation: "Cage B", quantity: 20 });
      expect(moved.status).toBe(200);
      expect(Object.fromEntries(moved.body.inventory.map((r: { location: string; quantity: string }) => [r.location, Number(r.quantity)]))).toEqual({ "Cage A": 30, "Cage B": 20 });
      const inv = (await request(app).get("/quarantine/inventory").set(as(qualityUser))).body as { byLocation: { location: string; quantity: number }[]; rows: { quarantineId: number }[] };
      expect(inv.rows.filter((r) => r.quarantineId === id)).toHaveLength(2);
      expect(inv.byLocation.find((l) => l.location === "Cage B")?.quantity).toBeGreaterThanOrEqual(20);
      expect((await request(app).get("/quarantine/inventory?location=Cage B").set(as(qualityUser))).body.rows.every((r: { location: string }) => r.location === "Cage B")).toBe(true);
    });

    it("takes a hold on something the system can't police — and says plainly that it isn't enforced", async () => {
      expect((await hold(qualityUser, { itemType: "finished_goods", quantity: 12 })).status).toBe(400); // needs a name
      const res = await hold(qualityUser, { itemType: "finished_goods", itemLabel: "Pallet 7 — Bracket 4400", quantity: 12, reasonCategory: "customer_return" });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ enforced: false, itemLabel: "Pallet 7 — Bracket 4400" });
      const note = (await db.select().from(notificationLog).where(and(eq(notificationLog.recipient, manager.email)))).find((m) => /Pallet 7/.test(m.subject));
      expect(note?.body).toMatch(/record only/i);
      // releasing it works the same way, with nothing in inventory to change
      const done = await request(app).post(`/quarantine/${res.body.id}/release`).set(as(manager)).send({ disposition: "reworked", notes: "Reworked and re-inspected" });
      expect(done.body.status).toBe("released");
    });

    it("summarises what is on hold, filters the list, and validates a linked NCR", async () => {
      const summary = (await request(app).get("/quarantine/summary").set(as(production))).body;
      expect(summary.openHolds).toBeGreaterThan(0);
      expect(summary.enforcedHolds + summary.notEnforcedHolds).toBe(summary.openHolds);
      const open = (await request(app).get("/quarantine?status=quarantined").set(as(production))).body as { status: string }[];
      expect(open.length).toBe(summary.openHolds);
      expect(open.every((r) => r.status === "quarantined")).toBe(true);
      expect((await request(app).get("/quarantine?q=Bracket").set(as(production))).body.length).toBeGreaterThanOrEqual(1);
      expect((await request(app).get("/quarantine?olderThanDays=1").set(as(production))).body).toEqual([]); // everything here is new

      const mine = (await db.insert(ncr).values({ title: "Linked NCR" }).returning())[0]!;
      
      const s = await stockedLot(5);
      
      const linked = await hold(qualityUser, { itemType: "inventory_lot", itemId: s.lotId, quantity: 1, ncrId: mine.id });
      expect(linked.body.ncrId).toBe(mine.id);
      const edited = await request(app).patch(`/quarantine/${linked.body.id}`).set(as(qualityUser)).send({ reason: "Reason updated after investigation", metadata: { target: { itemId: 999, lotId: 999 } } });
      expect(edited.status).toBe(200);
      expect(edited.body.metadata.target).toMatchObject({ itemId: s.itemId, lotId: s.lotId }); // the enforcement target can't be rewritten
      expect((await request(app).patch(`/quarantine/${linked.body.id}`).set(as(qualityUser)).send({ status: "released" })).status).toBe(400); // strict
    });
  });

  // -------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("receiving", () => {
    async function receivedLine(qty = 100) {
      const [item] = await db.insert(inventoryItems).values({ sku: `RCV-${Math.random().toString(36).slice(2, 8)}`, description: "Received part" }).returning();
      const purchasing = qualityUser; // the PO endpoints are gated by department; use API-created records through a purchasing user
      const buyer = await makeUser(companyId, `buyer-${Math.random().toString(36).slice(2, 6)}`, "operator", "purchasing");
      const receiver = await makeUser(companyId, `recv-${Math.random().toString(36).slice(2, 6)}`, "operator", "material_management");
      void purchasing;
      const po = await request(app).post("/erp/purchase-orders").set(as(buyer)).send({ supplierId, lineItems: [{ itemId: item!.id, quantity: qty, unitCost: 5 }] });
      expect(po.status).toBe(201);
      await request(app).post(`/erp/purchase-orders/${po.body.id}/send`).set(as(buyer));
      const detail = await request(app).get(`/erp/purchase-orders/${po.body.id}`).set(as(buyer));
      const lotNumber = `RL-${Math.random().toString(36).slice(2, 8)}`;
      const doc = await request(app).post("/erp/receiving-documents").set(as(receiver)).send({ purchaseOrderId: po.body.id, lineItems: [{ poLineItemId: detail.body.lineItems[0].id, quantityReceived: qty, lotNumber }] });
      expect(doc.status).toBe(201);
      const line = (await request(app).get(`/erp/receiving-documents/${doc.body.id}`).set(as(receiver))).body.lineItems[0];
      const status = (target: string, who: Who = qualityUser) => request(app).post(`/erp/receiving-line-items/${line.id}/status`).set(as(who)).send({ status: target });
      await status("pending_inspection");
      await status("inspected");
      return { itemId: item!.id, lineId: line.id as number, lotNumber, status };
    }

    it("puts the received stock on hold when a line is quarantined — and really stops it being used", async () => {
      const r = await receivedLine(100);
      expect((await r.status("quarantined")).status).toBe(200);
      const [q] = await db.select().from(quarantineRecords).where(and(eq(quarantineRecords.sourceType, "receiving_line_item"), eq(quarantineRecords.sourceId, r.lineId)));
      expect(q).toMatchObject({ status: "quarantined", enforced: true, itemType: "inventory_lot", reasonCategory: "nonconforming_material", lotNumber: r.lotNumber });
      expect(Number(q!.quantity)).toBe(100);
      expect(Number((await itemRow(r.itemId)).heldQty)).toBe(100);
      expect((await consume(r.itemId, 10)).status).toBe(409);
    });

    it("releases the hold when the line is then accepted", async () => {
      const r = await receivedLine(40);
      await r.status("quarantined");
      expect((await r.status("accepted")).status).toBe(200);
      const [q] = await db.select().from(quarantineRecords).where(and(eq(quarantineRecords.sourceId, r.lineId), eq(quarantineRecords.sourceType, "receiving_line_item")));
      expect(q).toMatchObject({ status: "released" });
      expect(Number((await itemRow(r.itemId)).heldQty)).toBe(0);
      expect((await consume(r.itemId, 10)).status).toBe(201);
      const decided = await db.select().from(quarantineResolutions).where(eq(quarantineResolutions.quarantineId, q!.id));
      expect(decided[0]).toMatchObject({ action: "release", disposition: "use_as_is" });
    });

    it("keeps the hold when the line is rejected, until someone returns or scraps it", async () => {
      const r = await receivedLine(25);
      await r.status("quarantined");
      expect((await r.status("rejected")).status).toBe(200);
      const [q] = await db.select().from(quarantineRecords).where(and(eq(quarantineRecords.sourceId, r.lineId), eq(quarantineRecords.sourceType, "receiving_line_item")));
      expect(q!.status).toBe("quarantined");
      expect(Number((await itemRow(r.itemId)).heldQty)).toBe(25);
      expect(await hasEvent(q!.id, "receiving_rejected")).toBe(true);
      const back = await request(app).post(`/quarantine/${q!.id}/destroy`).set(as(admin)).send({ disposition: "returned_to_supplier", notes: "Returned to the supplier under RMA" });
      expect(back.body.status).toBe("destroyed");
      expect(await onHand(r.itemId)).toBe(0);
    });
  });

  // -------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("who may do what, and organizations", () => {
    let id: number;
    let itemId: number;

    it("lets read-only departments look but not change anything", async () => {
      const s = await stockedLot(20);
      itemId = s.itemId;
      id = (await hold(qualityUser, { itemType: "inventory_lot", itemId: s.lotId, quantity: 10 })).body.id;
      for (const path of ["/quarantine", "/quarantine/summary", "/quarantine/inventory", `/quarantine/${id}`]) expect((await request(app).get(path).set(as(production))).status, path).toBe(200);
      for (const res of [
        await hold(production, { itemType: "inventory_lot", itemId: s.lotId, quantity: 1 }),
        await request(app).patch(`/quarantine/${id}`).set(as(production)).send({ reason: "changing it" }),
        await request(app).post(`/quarantine/${id}/relocate`).set(as(production)).send({ fromLocation: "Quarantine area", toLocation: "Elsewhere", quantity: 1 }),
        await request(app).post(`/quarantine/${id}/release`).set(as(production)).send({ disposition: "use_as_is", notes: "Looks fine to me" }),
        await request(app).post(`/quarantine/${id}/destroy`).set(as(production)).send({ disposition: "scrapped", notes: "Looks bad to me" }),
      ]) expect(res.status).toBe(403);
    });

    it("keeps out departments with no access and customers", async () => {
      for (const who of [sales, customer]) {
        expect((await request(app).get("/quarantine").set(as(who))).status).toBe(403);
        expect((await request(app).get(`/quarantine/${id}`).set(as(who))).status).toBe(403);
        expect((await hold(who, { itemType: "other", itemLabel: "x", quantity: 1 })).status).toBe(403);
      }
    });

    it("needs authentication", async () => {
      expect((await request(app).get("/quarantine")).status).toBe(401);
    });

    ;
  });
});
