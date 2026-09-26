import { ensureTestCompany } from "../helpers/company.js";
// Real-DB integration test (see company-isolation.test.ts's header comment).
// Full-System Audit finding H7: calibration had zero test coverage at all —
// no RBAC, and no coverage of createCalibrationEvent's real due-date
// calculation (nextDueAt = performedAt + calibrationIntervalDays). Also
// covers H2's new PATCH/DELETE routes (previously not mounted at all).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { db, pool } from "../../src/db/index.js";
import { company } from "../../src/drizzle/schema/company.js";
import { users } from "../../src/drizzle/schema/users.js";
import { equipment, calibrations } from "../../src/drizzle/schema/calibration.js";
import { auditTrail } from "../../src/drizzle/schema/auditTrail.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { seedDefaultPermissions } from "../helpers/seedDefaults.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";

const app = createApp();
const suffix = Date.now();

let companyId: number;
const userIds: number[] = [];
let qualityToken: string;
let engineeringToken: string;

async function makeUser(department: string | null) {
  const [user] = await db.insert(users).values({ email: `calibration-${department ?? "none"}-${suffix}-${Math.random().toString(36).slice(2, 7)}@test.local`, passwordHash: "unused" }).returning();
  userIds.push(user!.id);
  return signAccessToken({ sub: String(user!.id), roleId: null, roleName: "operator", department });
}

async function createEquipment(token: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app).post("/equipment").set("Authorization", `Bearer ${token}`).send({ name: "Fixture Gauge", calibrationIntervalDays: 90, ...overrides });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

describe("Calibration module (real DB + real HTTP path)", () => {
  beforeAll(async () => {
    const co = await ensureTestCompany();
    companyId = co!.id;
    await seedDefaultPermissions(companyId);

    qualityToken = await makeUser("quality");
    engineeringToken = await makeUser("engineering"); // calibration's default permissions are quality-only
  });

  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await pool.end();
  });

  it("engineering (zero access to calibration) cannot create equipment", async () => {
    const res = await request(app).post("/equipment").set("Authorization", `Bearer ${engineeringToken}`).send({ name: "Should be blocked" });
    expect(res.status).toBe(403);
  });

  it("logging a calibration event computes nextDueAt as performedAt + calibrationIntervalDays", async () => {
    const id = await createEquipment(qualityToken, { calibrationIntervalDays: 30 });
    const performedAt = new Date(Date.UTC(2027, 0, 1));
    const res = await request(app).post(`/equipment/${id}/calibration`).set("Authorization", `Bearer ${qualityToken}`).send({ performedAt: performedAt.toISOString(), result: "pass" });
    expect(res.status).toBe(201);

    const expectedDue = new Date(performedAt);
    expectedDue.setDate(expectedDue.getDate() + 30);
    expect(new Date(res.body.nextDueAt).getTime()).toBe(expectedDue.getTime());

    // The list endpoint (listWithStatus) is what the UI's status badge
    // actually reads — must resolve to the SAME latest event, not just the
    // raw equipment row.
    const list = await request(app).get("/equipment").set("Authorization", `Bearer ${qualityToken}`);
    const row = list.body.find((e: { id: number }) => e.id === id);
    expect(new Date(row.nextDueAt).getTime()).toBe(expectedDue.getTime());
  });

  it("a later calibration event replaces the equipment's reported due date, not the earlier one", async () => {
    const id = await createEquipment(qualityToken, { calibrationIntervalDays: 10 });
    await request(app).post(`/equipment/${id}/calibration`).set("Authorization", `Bearer ${qualityToken}`).send({ performedAt: new Date(Date.UTC(2027, 0, 1)).toISOString(), result: "pass" });
    const secondPerformedAt = new Date(Date.UTC(2027, 5, 1));
    await request(app).post(`/equipment/${id}/calibration`).set("Authorization", `Bearer ${qualityToken}`).send({ performedAt: secondPerformedAt.toISOString(), result: "adjusted" });

    const expectedDue = new Date(secondPerformedAt);
    expectedDue.setDate(expectedDue.getDate() + 10);
    const get = await request(app).get("/equipment").set("Authorization", `Bearer ${qualityToken}`);
    const row = get.body.find((e: { id: number }) => e.id === id);
    expect(new Date(row.nextDueAt).getTime()).toBe(expectedDue.getTime());
    expect(row.lastResult).toBe("adjusted");
  });

  // H2: PATCH/DELETE were never mounted at all before this fix.
  it("quality can edit equipment; engineering cannot", async () => {
    const id = await createEquipment(qualityToken);
    const blocked = await request(app).patch(`/equipment/${id}`).set("Authorization", `Bearer ${engineeringToken}`).send({ name: "Should be blocked" });
    expect(blocked.status).toBe(403);

    const res = await request(app).patch(`/equipment/${id}`).set("Authorization", `Bearer ${qualityToken}`).send({ name: "Renamed Gauge", location: "Cal Lab B" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Renamed Gauge");
    expect(res.body.location).toBe("Cal Lab B");

    const trail = await db.select().from(auditTrail).where(eq(auditTrail.entityId, id));
    expect(trail.some((t) => t.entityType === "Equipment" && t.action === "update")).toBe(true);
  });

  it("equipment with no calibration history can be deleted, and it is a real audited delete", async () => {
    const id = await createEquipment(qualityToken);
    const res = await request(app).delete(`/equipment/${id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(204);

    const getAfter = await request(app).get(`/equipment/${id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(getAfter.status).toBe(404);

    const trail = await db.select().from(auditTrail).where(eq(auditTrail.entityId, id));
    expect(trail.some((t) => t.entityType === "Equipment" && t.action === "delete")).toBe(true);
  });

  it("equipment WITH calibration history cannot be deleted — a clean 400, not a raw FK-violation crash", async () => {
    const id = await createEquipment(qualityToken);
    await request(app).post(`/equipment/${id}/calibration`).set("Authorization", `Bearer ${qualityToken}`).send({ performedAt: new Date().toISOString(), result: "pass" });

    const res = await request(app).delete(`/equipment/${id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(res.status).toBe(400);

    // Still there afterward — the guard ran before any delete was attempted.
    const getAfter = await request(app).get(`/equipment/${id}`).set("Authorization", `Bearer ${qualityToken}`);
    expect(getAfter.status).toBe(200);
  });

  it("engineering cannot delete equipment either", async () => {
    const id = await createEquipment(qualityToken);
    const res = await request(app).delete(`/equipment/${id}`).set("Authorization", `Bearer ${engineeringToken}`);
    expect(res.status).toBe(403);
  });
});
