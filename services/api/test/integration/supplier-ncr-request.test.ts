import { ensureTestCompany } from "../helpers/company.js";
// A supplier NCR request is a review item for Quality. It does not create an NCR or an RMA.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, and } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { suppliers } from "../../src/drizzle/schema/supplier.js";
import { ncr } from "../../src/drizzle/schema/ncr.js";
import { rma } from "../../src/drizzle/schema/rma.js";
import { supplierRmaRequests, rmaActivityLog } from "../../src/drizzle/schema/supplierRma.js";
import { notificationLog } from "../../src/drizzle/schema/notifications.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { ensureSupplierRole } from "../../src/modules/supplier/supplier.controller.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";

const app = createApp();
const suffix = Date.now();

let supplierAId: number;
let supplierBId: number;
let supplierAToken: string;
let supplierBToken: string;
let qualityToken: string;
let requestId: number;

async function makeInternalUser(department: string) {
  const [user] = await db
    .insert(users)
    .values({ email: `ncr-req-${department}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused", department })
    .returning();
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName: "operator", department });
}

async function makeSupplierLogin(supplierId: number) {
  const roleId = (await ensureSupplierRole(db)).id;
  const [user] = await db
    .insert(users)
    .values({ email: `ncr-req-login-${suffix}-${supplierId}@test.local`, passwordHash: "unused", department: null, roleId, supplierId })
    .returning();
  return signAccessToken({ sub: String(user!.id), roleId, roleName: "supplier", department: null, supplierId });
}

describe("Supplier Portal NCR request", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    const [supplierA] = await db.insert(suppliers).values({ name: `NCR Request Supplier A ${suffix}`, contactEmail: "a@supplier.test" }).returning();
    const [supplierB] = await db.insert(suppliers).values({ name: `NCR Request Supplier B ${suffix}`, contactEmail: "b@supplier.test" }).returning();
    supplierAId = supplierA!.id;
    supplierBId = supplierB!.id;
    supplierAToken = await makeSupplierLogin(supplierAId);
    supplierBToken = await makeSupplierLogin(supplierBId);
    qualityToken = await makeInternalUser("quality");
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("does not expose the old RMA request create path", async () => {
    const res = await request(app).post("/supplier-portal/rma-request").set("Authorization", `Bearer ${supplierAToken}`).send({ companyName: "x", contactName: "x", email: "x@test.local" });
    expect(res.status).toBe(404);
  });

  it("internal staff cannot submit an NCR request", async () => {
    const res = await request(app)
      .post("/supplier-portal/ncr-request")
      .set("Authorization", `Bearer ${qualityToken}`)
      .send({ companyName: "x", contactName: "x", email: "x@test.local", summary: "x" });
    expect(res.status).toBe(403);
  });

  it("a supplier submits a request for Quality without opening an NCR or an RMA", async () => {
    const ncrBefore = await db.select({ id: ncr.id }).from(ncr);
    const rmaBefore = await db.select({ id: rma.id }).from(rma);

    const res = await request(app).post("/supplier-portal/ncr-request").set("Authorization", `Bearer ${supplierAToken}`).send({
      companyName: "Acme Fasteners Co.",
      contactName: "Jane Doe",
      email: "jane@acmefasteners.test",
      phoneNumber: "555-0100",
      partNumber: "PN-100",
      summary: `Wrong thread pitch ${suffix}`,
      description: "Delivered batch does not match the print.",
    });

    expect(res.status).toBe(201);
    expect(res.body.rma).toBeUndefined();
    expect(res.body.ncr).toBeUndefined();
    expect(res.body.request.status).toBe("submitted");
    expect(res.body.request.supplierId).toBe(supplierAId);
    expect(res.body.request.shortDescription).toBe(`Wrong thread pitch ${suffix}`);
    expect(res.body.request.createdRmaId).toBeNull();
    requestId = res.body.request.id;

    expect(await db.select({ id: ncr.id }).from(ncr)).toHaveLength(ncrBefore.length);
    expect(await db.select({ id: rma.id }).from(rma)).toHaveLength(rmaBefore.length);

    const [stored] = await db.select().from(supplierRmaRequests).where(eq(supplierRmaRequests.id, requestId));
    expect(stored!.status).toBe("submitted");
    expect(stored!.supplierId).toBe(supplierAId);
  });

  it("Quality is notified and the request is on the activity trail", async () => {
    const notes = await db.select().from(notificationLog).where(and(eq(notificationLog.relatedEntityType, "SupplierNcrRequest"), eq(notificationLog.relatedEntityId, requestId)));
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.some((row) => row.subject.includes("NCR request"))).toBe(true);

    const events = await db.select().from(rmaActivityLog).where(eq(rmaActivityLog.supplierRmaRequestId, requestId));
    expect(events.map((row) => row.event)).toEqual(expect.arrayContaining(["ncr_request_submitted", "notifications_sent"]));

    const audit = await db.select().from(auditTrail).where(and(eq(auditTrail.entityType, "SupplierNcrRequest"), eq(auditTrail.entityId, requestId)));
    expect(audit.length).toBeGreaterThan(0);
  });

  it("the supplier sees their own request, and another supplier cannot", async () => {
    const own = await request(app).get("/supplier-portal/ncr-request").set("Authorization", `Bearer ${supplierAToken}`);
    expect(own.status).toBe(200);
    expect(own.body.map((row: { id: number }) => row.id)).toContain(requestId);

    const forged = await request(app).get("/supplier-portal/ncr-request").query({ supplierId: supplierAId }).set("Authorization", `Bearer ${supplierBToken}`);
    expect(forged.status).toBe(200);
    expect(forged.body).toHaveLength(0);

    const other = await request(app).get("/supplier-portal/ncr-request").set("Authorization", `Bearer ${supplierBToken}`);
    expect(other.body).toHaveLength(0);
  });

  it("Quality can see the request, and the supplier still cannot open a staff NCR by id", async () => {
    const list = await request(app).get("/supplier-portal/ncr-request").query({ supplierId: supplierAId }).set("Authorization", `Bearer ${qualityToken}`);
    expect(list.status).toBe(200);
    expect(list.body.map((row: { id: number }) => row.id)).toContain(requestId);

    const all = await request(app).get("/supplier-portal/ncr-request").set("Authorization", `Bearer ${qualityToken}`);
    expect(all.body.map((row: { id: number }) => row.id)).toContain(requestId);

    expect((await request(app).get("/ncr/1").set("Authorization", `Bearer ${supplierAToken}`)).status).toBe(403);
    expect((await request(app).get("/8d/1").set("Authorization", `Bearer ${supplierAToken}`)).status).toBe(403);
    expect((await request(app).get("/users").set("Authorization", `Bearer ${supplierAToken}`)).status).toBe(403);
  });
});
