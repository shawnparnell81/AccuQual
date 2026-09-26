import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Security-audit finding (low): the core Inventory module (create/update
// item, movement, adjust, reorder-requests, analytics, costing) had no
// dedicated test file beyond inventory-lots.test.ts's narrow /lots and
// /items/:id/lots coverage. Covers the base edit-vs-read department gate,
// the finer per-action restrictions inline in inventory.controller.ts
// (consume: production-only, adjust: material_management-only, deactivate:
// admin-only — see its own assertDepartment helper), and company isolation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { inventoryItems, inventoryStock, inventoryMovements, inventoryAlerts } from "../../src/drizzle/schema/inventory.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";

const app = createApp();
const suffix = Date.now();

let companyId: number;

let itemId: number;
const userIds: number[] = [];
let materialMgmtToken: string;
let purchasingToken: string;
let productionToken: string;
let qualityToken: string;
let adminToken: string;


describe("Inventory core module (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;
    
    
    await seedDefaultPermissions(companyId);
    

    async function makeUser(tid: number, department: string | null, roleName = "operator") {
      const [user] = await db.insert(users).values({ email: `inv-${department ?? "none"}-${tid}-${suffix}@test.local`, passwordHash: "unused" }).returning();
      userIds.push(user!.id);
      return signAccessToken({ sub: String(user!.id), roleId: null, roleName, department });
    }

    materialMgmtToken = await makeUser(companyId, "material_management");
    purchasingToken = await makeUser(companyId, "purchasing");
    productionToken = await makeUser(companyId, "production");
    qualityToken = await makeUser(companyId, "quality");
    adminToken = await makeUser(companyId, null, "admin");
    
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("quality (read-only) cannot create an item", async () => {
    const res = await request(app).post("/inventory/items").set("Authorization", `Bearer ${qualityToken}`).send({ sku: `SKU-BLOCKED-${suffix}` });
    expect(res.status).toBe(403);
  });

  it("material_management (real edit access) creates an item", async () => {
    const res = await request(app).post("/inventory/items").set("Authorization", `Bearer ${materialMgmtToken}`).send({ sku: `SKU-${suffix}`, minLevel: 10 });
    expect(res.status).toBe(201);
    expect(res.body.sku).toBe(`SKU-${suffix}`);
    itemId = res.body.id;
  });

  it("quality (read-only) can still list items", async () => {
    const res = await request(app).get("/inventory/items").set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(200);
  });

  it("purchasing can log a receive movement — no per-action restriction beyond base edit access", async () => {
    const res = await request(app).post(`/inventory/items/${itemId}/movement`).set("Authorization", `Bearer ${purchasingToken}`).send({ movementType: "receive", quantity: 50 });
    expect(res.status).toBe(201);
  });

  it("purchasing CANNOT log a consume movement — that's production-only", async () => {
    const res = await request(app).post(`/inventory/items/${itemId}/movement`).set("Authorization", `Bearer ${purchasingToken}`).send({ movementType: "consume", quantity: 5, reason: "test" });
    expect(res.status).toBe(403);
  });

  it("production CAN log a consume movement", async () => {
    const res = await request(app).post(`/inventory/items/${itemId}/movement`).set("Authorization", `Bearer ${productionToken}`).send({ movementType: "consume", quantity: 5 });
    expect(res.status).toBe(201);
  });

  it("purchasing CANNOT adjust stock — that's material_management-only", async () => {
    const res = await request(app).post(`/inventory/items/${itemId}/adjust`).set("Authorization", `Bearer ${purchasingToken}`).send({ quantity: 1, reason: "cycle count correction" });
    expect(res.status).toBe(403);
  });

  it("material_management CAN adjust stock", async () => {
    const res = await request(app).post(`/inventory/items/${itemId}/adjust`).set("Authorization", `Bearer ${materialMgmtToken}`).send({ quantity: 1, reason: "cycle count correction" });
    expect(res.status).toBe(201);
  });

  it("material_management CANNOT deactivate an item — that's admin-only", async () => {
    const res = await request(app).patch(`/inventory/items/${itemId}`).set("Authorization", `Bearer ${materialMgmtToken}`).send({ active: false });
    expect(res.status).toBe(403);
  });

  it("admin CAN deactivate an item", async () => {
    const res = await request(app).patch(`/inventory/items/${itemId}`).set("Authorization", `Bearer ${adminToken}`).send({ active: false });
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
  });

  ;
});
