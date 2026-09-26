import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment
// for why this category exists and what it needs). Uses RMA as the
// representative module because it exercises both permission layers this
// app has: the coarse department PERMISSION_MATRIX (middleware/
// departmentAccess.ts, enforced by requireDepartmentAccess) and the
// finer-than-matrix inline rules every module's own controller adds on top
// (Inspection Report PER-01/PER-03) — exactly the two layers a silent
// permission regression could slip between.
//
// Every token below that can reach a real write carries a REAL users.id —
// audit_trail.performedBy is a real FK, and (as of the recordAuditTrail fix
// this test suite found) a bad FK there now correctly fails the whole
// request instead of silently rolling back while reporting success.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { suppliers } from "../../src/drizzle/schema/supplier.js";
import { rma } from "../../src/drizzle/schema/rma.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
const app = createApp();
const suffix = Date.now();

let companyId: number;
let supplierId: number;
let rmaId: number;
const userIds: number[] = [];

let purchasingUserId: number;
let materialMgmtUserId: number;
let qualityUserId: number;

let purchasingToken: string;
let materialMgmtToken: string;
let qualityToken: string;
let engineeringToken: string;
let productionToken: string;

async function makeUser(department: string) {
  const [user] = await db.insert(users).values({ email: `perm-test-${department}-${suffix}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return user!.id;
}

function tokenFor(userId: number, department: string | null) {
  return signAccessToken({ sub: String(userId), roleId: null, roleName: "operator", department });
}

describe("department permissions (real DB + real HTTP path, via RMA)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;

    await seedDefaultPermissions(companyId);

    const [supplier] = await db.insert(suppliers).values({ name: `Perm Test Supplier ${suffix}` }).returning();
    supplierId = supplier!.id;

    purchasingUserId = await makeUser("purchasing");
    materialMgmtUserId = await makeUser("material-management");
    qualityUserId = await makeUser("quality");
    // engineering/production tokens are expected to be rejected before any
    // write is attempted, so they don't need a real users row — but they
    // still need *a* userId for the JWT `sub` claim's shape.
    const engineeringUserId = await makeUser("engineering");
    const productionUserId = await makeUser("production");

    purchasingToken = tokenFor(purchasingUserId, "purchasing");
    materialMgmtToken = tokenFor(materialMgmtUserId, "material_management");
    qualityToken = tokenFor(qualityUserId, "quality");
    engineeringToken = tokenFor(engineeringUserId, "engineering");
    productionToken = tokenFor(productionUserId, "production");
  });

  afterAll(async () => {
    // Same grace period as company-isolation.test.ts's afterAll — several
    // tests here trigger a 403/400 against a real "rma" route, and
    // errorHandler.ts's logFailedTransition (fire-and-forget, by design)
    // writes its own standalone audit_trail row for those slightly after
    // this test's own await already resolved.
    await new Promise((r) => setTimeout(r, 200));
    await pool.end();
  });

  it("engineering (read-only in the matrix) is rejected on a write, before any controller code runs", async () => {
    const res = await request(app).post("/rma").set("Authorization", `Bearer ${engineeringToken}`).send({ supplierId });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/read-only/i);
  });

  it("production (no matrix entry for rma at all) is rejected even on a read", async () => {
    const res = await request(app).get("/rma").set("Authorization", `Bearer ${productionToken}`);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/no access/i);
  });

  it("engineering can still read, since its matrix level is 'read' not 'none'", async () => {
    const res = await request(app).get("/rma").set("Authorization", `Bearer ${engineeringToken}`);
    expect(res.status).toBe(200);
  });

  it("purchasing can create an RMA — full RMA access includes create", async () => {
    const res = await request(app).post("/rma").set("Authorization", `Bearer ${purchasingToken}`).send({ supplierId, reasonCode: "defective" });
    expect(res.status).toBe(201);
    expect(res.body.rmaNumber).toMatch(/^RMA-/);
    expect(res.body.createdByUserId).toBe(purchasingUserId);
    rmaId = res.body.id;
  });

  it("quality cannot create an RMA — its access is narrower than 'full RMA access' implies", async () => {
    const res = await request(app).post("/rma").set("Authorization", `Bearer ${qualityToken}`).send({ supplierId });
    expect(res.status).toBe(403);
  });

  it("quality is rejected touching supplierId on PATCH — allowed only notes/linkage", async () => {
    const res = await request(app).patch(`/rma/${rmaId}`).set("Authorization", `Bearer ${qualityToken}`).send({ supplierId });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/notes/i);
  });

  it("quality CAN patch notes — the one field the spec explicitly grants it", async () => {
    const res = await request(app).patch(`/rma/${rmaId}`).set("Authorization", `Bearer ${qualityToken}`).send({ notes: "quality's note" });
    expect(res.status).toBe(200);
    expect(res.body.notes).toBe("quality's note");
  });

  it("quality cannot submit the RMA to the supplier — status transitions are purchasing/material_management only", async () => {
    const res = await request(app).post(`/rma/${rmaId}/status`).set("Authorization", `Bearer ${qualityToken}`).send({ status: "submitted_to_supplier" });
    expect(res.status).toBe(403);
  });

  it("material_management CAN submit — part of 'full RMA access'", async () => {
    const res = await request(app).post(`/rma/${rmaId}/status`).set("Authorization", `Bearer ${materialMgmtToken}`).send({ status: "submitted_to_supplier" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("submitted_to_supplier");
  });

  it("material_management cannot approve — the spec grants approve to purchasing only", async () => {
    const res = await request(app).post(`/rma/${rmaId}/status`).set("Authorization", `Bearer ${materialMgmtToken}`).send({ status: "approved_by_supplier" });
    expect(res.status).toBe(403);
  });

  it("purchasing CAN approve", async () => {
    const res = await request(app).post(`/rma/${rmaId}/status`).set("Authorization", `Bearer ${purchasingToken}`).send({ status: "approved_by_supplier" });
    expect(res.status).toBe(200);
    expect(res.body.approvedByUserId).toBe(purchasingUserId);
  });

  it("an out-of-sequence transition is rejected regardless of department", async () => {
    const res = await request(app).post(`/rma/${rmaId}/status`).set("Authorization", `Bearer ${purchasingToken}`).send({ status: "closed" });
    expect(res.status).toBe(400);
  });

  it("material_management cannot close — 'Only admin/purchasing can close' per the spec", async () => {
    const toTransit = await request(app).post(`/rma/${rmaId}/status`).set("Authorization", `Bearer ${purchasingToken}`).send({ status: "in_transit" });
    expect(toTransit.status).toBe(200);
    const toReceived = await request(app).post(`/rma/${rmaId}/status`).set("Authorization", `Bearer ${purchasingToken}`).send({ status: "received_by_supplier" });
    expect(toReceived.status).toBe(200);

    const res = await request(app).post(`/rma/${rmaId}/status`).set("Authorization", `Bearer ${materialMgmtToken}`).send({ status: "closed" });
    expect(res.status).toBe(403);
  });

  it("purchasing CAN close", async () => {
    const res = await request(app).post(`/rma/${rmaId}/status`).set("Authorization", `Bearer ${purchasingToken}`).send({ status: "closed" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("closed");
  });
});
