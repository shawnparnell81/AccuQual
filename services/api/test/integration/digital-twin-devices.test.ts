import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment
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
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { iotDevices, digitalTwinModels } from "../../src/drizzle/schema/digitalTwin.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";

const app = createApp();
const suffix = Date.now();

let companyId: number;

const userIds: number[] = [];
let adminToken: string;
let operatorToken: string;

async function makeUser(forCompanyId: number, roleName: string) {
  const [user] = await db.insert(users).values({ email: `dt-device-${roleName}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName, department: null });
}

describe("Digital Twin IoT devices — edit/delete (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;
    
    

    adminToken = await makeUser(companyId, "admin");
    operatorToken = await makeUser(companyId, "operator");
  });

  afterAll(async () => {
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
    const [model] = await db.insert(digitalTwinModels).values({ name: `DT Device Test Model ${suffix}`, modelJson: { nodes: [], edges: [] } }).returning();
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

  ;
});
