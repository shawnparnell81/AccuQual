import { ensureTestCompany } from "../helpers/company.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { addDays } from "../../src/modules/calibration/calibration.service.js";

const app = createApp();
const suffix = Date.now();
let qualityToken: string;
let engineeringToken: string;

async function makeUser(department: string) {
  const [user] = await db
    .insert(users)
    .values({ email: `gage-use-${department}-${suffix}@test.local`, passwordHash: "unused", department })
    .returning();
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName: "operator", department });
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const day = (offset: number) => addDays(new Date(), offset).toISOString();

async function newEquipment(body: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/equipment")
    .set(as(qualityToken))
    .send({ name: `Gage ${Math.random().toString(36).slice(2, 7)}`, type: "caliper", calibrationIntervalDays: 90, ...body });
  expect(res.status).toBe(201);
  return res.body as { id: number; name: string };
}

describe("gage usage enforcement", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    await seedDefaultPermissions(co!.id);
    qualityToken = await makeUser("quality");
    engineeringToken = await makeUser("engineering");
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("refuses a gage R&R on an overdue, failed, or inactive gage and allows a current one", async () => {
    const overdue = await newEquipment();
    const logged = await request(app).post(`/equipment/${overdue.id}/calibration`).set(as(qualityToken)).send({ performedAt: day(-200), result: "pass" });
    expect(logged.status).toBe(201);
    const blocked = await request(app).post(`/forms/gage_rr/${overdue.id}/save`).set(as(qualityToken)).send({ entityId: overdue.id, data: { note: "study" } });
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toMatch(/overdue/i);

    const failed = await newEquipment();
    const fail = await request(app).post(`/equipment/${failed.id}/calibration`).set(as(qualityToken)).send({ performedAt: day(-1), result: "fail" });
    expect(fail.status).toBe(201);
    const failedUse = await request(app).post(`/forms/gage_rr/${failed.id}/save`).set(as(qualityToken)).send({ entityId: failed.id, data: { note: "study" } });
    expect(failedUse.status).toBe(400);
    expect(failedUse.body.message).toMatch(/out of service/i);

    const inactive = await newEquipment({ name: "Shelved gage", status: "inactive" });
    const inactiveUse = await request(app).post(`/forms/gage_rr/${inactive.id}/save`).set(as(qualityToken)).send({ entityId: inactive.id, data: { note: "study" } });
    expect(inactiveUse.status).toBe(400);
    expect(inactiveUse.body.message).toMatch(/inactive/i);

    const current = await newEquipment();
    const pass = await request(app).post(`/equipment/${current.id}/calibration`).set(as(qualityToken)).send({ performedAt: day(0), result: "pass" });
    expect(pass.status).toBe(201);
    const allowed = await request(app).post(`/forms/gage_rr/${current.id}/save`).set(as(qualityToken)).send({ entityId: current.id, data: { note: "study" } });
    expect(allowed.status).toBe(200);

    const calForm = await request(app)
      .post(`/forms/calibration/${overdue.id}/save`)
      .set(as(qualityToken))
      .send({ entityId: overdue.id, data: { performedAt: day(0), result: "pass", technicianName: "Pat" } });
    expect(calForm.status).toBe(200);
  });

  it("rejects a final inspection that names an unusable gage and accepts an unknown gage id", async () => {
    const gage = await newEquipment({ name: "Bench mic", serialNumber: `CAL-${suffix}` });
    await request(app).post(`/equipment/${gage.id}/calibration`).set(as(qualityToken)).send({ performedAt: day(-200), result: "pass" });

    const named = await request(app)
      .post("/forms/final_inspection_release_checklist/1/save")
      .set(as(engineeringToken))
      .send({ data: { keyCharacteristicResults: [{ characteristic: "OD", gageId: `CAL-${suffix}` }] } });
    expect(named.status).toBe(400);
    expect(named.body.message).toMatch(/overdue/i);

    const unknown = await request(app)
      .post("/forms/final_inspection_release_checklist/1/save")
      .set(as(engineeringToken))
      .send({ data: { keyCharacteristicResults: [{ characteristic: "OD", gageId: "not-on-the-list" }] } });
    expect(unknown.status).toBe(200);
  });
});
