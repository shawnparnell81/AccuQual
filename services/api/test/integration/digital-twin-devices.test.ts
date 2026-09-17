// Real-DB integration test (see tenant-isolation.test.ts's header comment
// for why this category exists). Covers the two real Digital Twin device
// gaps closed this round: PATCH /devices/:id (edit-by-id, previously only
// reachable via the registration endpoint's upsert-by-deviceId semantics,
// with no way to clear a field back to null) and DELETE /devices/:id
// (previously impossible — no route existed at all).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { tenants } from "../../src/drizzle/schema/tenants.js";
import { users } from "../../src/drizzle/schema/users.js";
import { iotDevices, digitalTwinModels } from "../../src/drizzle/schema/digitalTwin.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();

let tenantId: number;
let otherTenantId: number;
const userIds: number[] = [];
let adminToken: string;
let operatorToken: string;

async function makeUser(forTenantId: number, roleName: string) {
  const [user] = await db.insert(users).values({ tenantId: forTenantId, email: `dt-device-${roleName}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), tenantId: forTenantId, roleId: null, roleName, department: null });
}

describe("Digital Twin IoT devices — edit/delete (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const [tenant] = await db.insert(tenants).values({ name: `DT Device Test Tenant ${suffix}`, code: `dt-device-${suffix}` }).returning();
    tenantId = tenant!.id;
    const [other] = await db.insert(tenants).values({ name: `DT Device Other Tenant ${suffix}`, code: `dt-device-other-${suffix}` }).returning();
    otherTenantId = other!.id;

    adminToken = await makeUser(tenantId, "admin");
    operatorToken = await makeUser(tenantId, "operator");
  });

  afterAll(async () => {
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, tenantId));
    await db.delete(auditTrail).where(eq(auditTrail.tenantId, otherTenantId));
    await db.delete(iotDevices).where(eq(iotDevices.tenantId, tenantId));
    await db.delete(iotDevices).where(eq(iotDevices.tenantId, otherTenantId));
    await db.delete(digitalTwinModels).where(eq(digitalTwinModels.tenantId, tenantId));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    await db.delete(tenants).where(eq(tenants.id, otherTenantId));
    await pool.end();
  });

  it("edits an already-registered device's name/type by id", async () => {
    const created = await request(app).post("/digital-twin/devices").set("Authorization", `Bearer ${adminToken}`).send({ deviceId: `edit-${suffix}` });
    expect(created.status).toBe(201);

    const patched = await request(app)
      .patch(`/digital-twin/devices/${created.body.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Renamed Sensor", type: "sensor" });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ name: "Renamed Sensor", type: "sensor" });
  });

  it("can clear a field back to null — the one thing the upsert-by-deviceId path could never do", async () => {
    const created = await request(app)
      .post("/digital-twin/devices")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ deviceId: `clear-${suffix}`, name: "Has A Name" });
    expect(created.body.name).toBe("Has A Name");

    const cleared = await request(app).patch(`/digital-twin/devices/${created.body.id}`).set("Authorization", `Bearer ${adminToken}`).send({ name: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.name).toBeNull();
  });

  it("rejects linking a digitalTwinModelId that doesn't exist", async () => {
    const created = await request(app).post("/digital-twin/devices").set("Authorization", `Bearer ${adminToken}`).send({ deviceId: `bad-link-${suffix}` });
    const patched = await request(app).patch(`/digital-twin/devices/${created.body.id}`).set("Authorization", `Bearer ${adminToken}`).send({ digitalTwinModelId: 999999999 });
    expect(patched.status).toBe(404);
  });

  it("links to a real model, then unlinks it back to null", async () => {
    const [model] = await db.insert(digitalTwinModels).values({ tenantId, name: `DT Device Test Model ${suffix}`, modelJson: { nodes: [], edges: [] } }).returning();
    const created = await request(app).post("/digital-twin/devices").set("Authorization", `Bearer ${adminToken}`).send({ deviceId: `link-${suffix}` });

    const linked = await request(app).patch(`/digital-twin/devices/${created.body.id}`).set("Authorization", `Bearer ${adminToken}`).send({ digitalTwinModelId: model!.id });
    expect(linked.status).toBe(200);
    expect(linked.body.digitalTwinModelId).toBe(model!.id);

    const unlinked = await request(app).patch(`/digital-twin/devices/${created.body.id}`).set("Authorization", `Bearer ${adminToken}`).send({ digitalTwinModelId: null });
    expect(unlinked.status).toBe(200);
    expect(unlinked.body.digitalTwinModelId).toBeNull();
  });

  it("a non-admin cannot edit or delete a device", async () => {
    const created = await request(app).post("/digital-twin/devices").set("Authorization", `Bearer ${adminToken}`).send({ deviceId: `rbac-${suffix}` });

    const patchAttempt = await request(app).patch(`/digital-twin/devices/${created.body.id}`).set("Authorization", `Bearer ${operatorToken}`).send({ name: "Should not work" });
    expect(patchAttempt.status).toBe(403);

    const deleteAttempt = await request(app).delete(`/digital-twin/devices/${created.body.id}`).set("Authorization", `Bearer ${operatorToken}`);
    expect(deleteAttempt.status).toBe(403);
  });

  it("deletes a device — previously impossible, no route existed at all", async () => {
    const created = await request(app).post("/digital-twin/devices").set("Authorization", `Bearer ${adminToken}`).send({ deviceId: `delete-${suffix}` });

    const deleted = await request(app).delete(`/digital-twin/devices/${created.body.id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(deleted.status).toBe(204);

    const list = await request(app).get("/digital-twin/devices").set("Authorization", `Bearer ${adminToken}`);
    expect(list.body.find((d: { id: number }) => d.id === created.body.id)).toBeUndefined();
  });

  it("cannot edit or delete another tenant's device — real tenant isolation, not just a happy-path route", async () => {
    const otherAdminToken = await makeUser(otherTenantId, "admin");
    const otherDevice = await request(app).post("/digital-twin/devices").set("Authorization", `Bearer ${otherAdminToken}`).send({ deviceId: `other-tenant-${suffix}` });
    expect(otherDevice.status).toBe(201);

    const patchAttempt = await request(app).patch(`/digital-twin/devices/${otherDevice.body.id}`).set("Authorization", `Bearer ${adminToken}`).send({ name: "Should not work" });
    expect(patchAttempt.status).toBe(404);

    const deleteAttempt = await request(app).delete(`/digital-twin/devices/${otherDevice.body.id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(deleteAttempt.status).toBe(404);
  });
});
